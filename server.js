const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '50mb' }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.method === 'POST') {
    const logBody = { ...req.body };
    if (logBody.image?.data) {
      logBody.image.data = '[BASE64_IMAGE_DATA_TRUNCATED]';
    }
    console.log('Request body:', JSON.stringify(logBody, null, 2));
    console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  }
  next();
});

app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ status: 'OK', service: 'Facebook API Server' });
});

app.post('/api/facebook/post', async (req, res) => {
  console.log('=== Facebook POST request received ===');
  
  try {
    const { content, hashtags, pageId, image, facebookEndpoint, usePhotosEndpoint } = req.body;
    const userAccessToken = req.headers.authorization?.replace('Bearer ', '');

    console.log('Parsed request data:', {
      content: content ? `${content.substring(0, 50)}...` : 'MISSING',
      hashtags: hashtags,
      pageId: pageId,
      hasToken: !!userAccessToken,
      hasImage: !!image,
      requestedEndpoint: facebookEndpoint || (usePhotosEndpoint ? 'photos' : 'feed')
    });

    if (!content) {
      console.log('ERROR: Content is missing');
      return res.status(400).json({ error: 'Content is required' });
    }

    if (!userAccessToken) {
      console.log('ERROR: Access token is missing');
      return res.status(400).json({ error: 'Access token is required' });
    }

    // Use pageId from request if provided, otherwise fall back to environment variable
    const targetPageId = pageId || process.env.FACEBOOK_PAGE_ID;
    
    if (!targetPageId) {
      console.log('ERROR: Page ID is missing');
      return res.status(400).json({ error: 'Page ID is required (either in request or environment)' });
    }

    console.log('Target page ID:', targetPageId);

    // Check if we have an image to post
    if (image && image.data && (facebookEndpoint === 'photos' || usePhotosEndpoint)) {
      console.log('Processing image post via /photos endpoint...');
      
      // Prepare post text with hashtags for photo post
      let postText = content;
      if (hashtags && hashtags.length > 0) {
        const hashtagText = hashtags.map(tag => 
          tag.startsWith('#') ? tag : `#${tag}`
        ).join(' ');
        postText = `${content}\n\n${hashtagText}`;
      }

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(image.data, 'base64');
      console.log(`Image buffer size: ${imageBuffer.length} bytes`);

      // Create form data for multipart upload
      const formData = new FormData();
      formData.append('message', postText);
      formData.append('access_token', userAccessToken);
      formData.append('source', imageBuffer, {
        filename: image.filename || 'image.jpg',
        contentType: image.mimeType || 'image/jpeg'
      });

      console.log('Form data prepared for /photos endpoint, making Facebook API request...');

      // Post to Facebook page photos endpoint
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${targetPageId}/photos`,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          }
        }
      );

      console.log('Facebook /photos API SUCCESS:', response.data);

      res.json({
        success: true,
        post_id: response.data.id,
        post_url: `https://facebook.com/${response.data.id}`,
        platform: 'Facebook',
        endpoint_used: 'photos'
      });

    } else {
      console.log('Processing text-only post via /feed endpoint...');
      
      // Prepare post text for text-only post
      let postText = content;
      if (hashtags && hashtags.length > 0) {
        const hashtagText = hashtags.map(tag => 
          tag.startsWith('#') ? tag : `#${tag}`
        ).join(' ');
        postText = `${content}\n\n${hashtagText}`;
      }

      console.log('Final post text length:', postText.length);

      // Create URLSearchParams object for proper form encoding
      const formData = new URLSearchParams();
      formData.append('message', postText);
      formData.append('access_token', userAccessToken);

      console.log('Form data prepared for /feed endpoint, making Facebook API request...');

      // Post to Facebook page using properly form-encoded data
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${targetPageId}/feed`,
        formData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      console.log('Facebook /feed API SUCCESS:', response.data);

      res.json({
        success: true,
        post_id: response.data.id,
        post_url: `https://facebook.com/${response.data.id}`,
        platform: 'Facebook',
        endpoint_used: 'feed'
      });
    }

  } catch (error) {
    console.error('=== Facebook API Error ===');
    console.error('Error message:', error.message);
    console.error('Error response status:', error.response?.status);
    console.error('Error response data:', error.response?.data);
    console.error('Full error:', error);
    
    res.status(500).json({
      error: 'Failed to post to Facebook',
      message: error.response?.data?.error?.message || error.message,
      facebookError: error.response?.data?.error
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Facebook API Server running on port ${PORT}`);
});
