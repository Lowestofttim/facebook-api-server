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

      console.log('Final post text for photo:', postText.substring(0, 100) + '...');

      // Convert base64 to buffer with validation
      let imageBuffer;
      try {
        // Remove any data URL prefix if present
        const base64Data = image.data.replace(/^data:image\/[a-z]+;base64,/, '');
        imageBuffer = Buffer.from(base64Data, 'base64');
        console.log(`Image buffer size: ${imageBuffer.length} bytes`);
        console.log(`Original MIME type: ${image.mimeType}`);
        console.log(`Original filename: ${image.filename}`);
      } catch (error) {
        console.error('Error converting base64 to buffer:', error);
        throw new Error('Invalid image data format');
      }

      // Validate image size (Facebook limit is 10MB)
      if (imageBuffer.length > 10 * 1024 * 1024) {
        console.error(`Image too large: ${imageBuffer.length} bytes (limit: 10MB)`);
        throw new Error('Image file too large for Facebook (max 10MB)');
      }

      // Validate that we have actual image data
      if (imageBuffer.length < 100) {
        console.error(`Image buffer too small: ${imageBuffer.length} bytes`);
        throw new Error('Image data appears to be corrupted or empty');
      }

      // Determine proper content type and filename
      let contentType = 'image/jpeg'; // Default to JPEG
      let filename = 'monkeyzoo_image.jpg';

      if (image.mimeType) {
        if (image.mimeType.includes('png')) {
          contentType = 'image/png';
          filename = 'monkeyzoo_image.png';
        } else if (image.mimeType.includes('gif')) {
          contentType = 'image/gif';
          filename = 'monkeyzoo_image.gif';
        } else if (image.mimeType.includes('webp')) {
          contentType = 'image/webp';
          filename = 'monkeyzoo_image.webp';
        } else if (image.mimeType.includes('jpeg') || image.mimeType.includes('jpg')) {
          contentType = 'image/jpeg';
          filename = 'monkeyzoo_image.jpg';
        }
      }

      // Use original filename if provided and has valid extension
      if (image.filename && typeof image.filename === 'string') {
        const originalName = image.filename.toLowerCase();
        if (originalName.endsWith('.jpg') || originalName.endsWith('.jpeg') || 
            originalName.endsWith('.png') || originalName.endsWith('.gif') || 
            originalName.endsWith('.webp')) {
          filename = image.filename;
        }
      }

      console.log(`Final filename: ${filename}`);
      console.log(`Final content type: ${contentType}`);

      // Create form data for multipart upload
      const formData = new FormData();
      
      // Add the message first
      formData.append('message', postText);
      
      // Add the access token
      formData.append('access_token', userAccessToken);
      
      // Add the image file with proper stream handling
      formData.append('source', imageBuffer, {
        filename: filename,
        contentType: contentType,
        knownLength: imageBuffer.length
      });

      console.log('Form data prepared for /photos endpoint');
      console.log(`Ready to upload: ${filename} (${imageBuffer.length} bytes, ${contentType})`);

      // Post to Facebook page photos endpoint
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${targetPageId}/photos`,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000 // 60 second timeout for image uploads
        }
      );

      console.log('Facebook /photos API SUCCESS:', response.data);

      res.json({
        success: true,
        post_id: response.data.id,
        post_url: `https://facebook.com/${response.data.id}`,
        platform: 'Facebook',
        endpoint_used: 'photos',
        image_uploaded: true,
        image_info: {
          filename: filename,
          size: imageBuffer.length,
          contentType: contentType
        }
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
        endpoint_used: 'feed',
        image_uploaded: false
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
