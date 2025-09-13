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
    console.log('Request body:', JSON.stringify(logBody, null, 2));
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
    const { content, hashtags, pageId, googleDriveFile, facebookEndpoint, usePhotosEndpoint } = req.body;
    const userAccessToken = req.headers.authorization?.replace('Bearer ', '');

    console.log('Parsed request data:', {
      content: content ? `${content.substring(0, 50)}...` : 'MISSING',
      hashtags: hashtags,
      pageId: pageId,
      hasToken: !!userAccessToken,
      hasGoogleDriveFile: !!googleDriveFile,
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

    // Check if we have a Google Drive file to download and post
    if (googleDriveFile && googleDriveFile.id && (facebookEndpoint === 'photos' || usePhotosEndpoint)) {
      console.log('Processing image post via /photos endpoint...');
      console.log(`Google Drive file: ${googleDriveFile.name} (${googleDriveFile.id})`);
      
      // Download image from Google Drive
      let imageBuffer;
      try {
        console.log(`Downloading image from Google Drive: ${googleDriveFile.id}`);
        
        // Download the image directly from Google Drive using public URL
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${googleDriveFile.id}`;
        const imageResponse = await axios.get(downloadUrl, {
          responseType: 'arraybuffer',
          timeout: 30000
        });
        
        imageBuffer = Buffer.from(imageResponse.data);
        console.log(`Successfully downloaded image: ${imageBuffer.length} bytes`);
        
        if (imageBuffer.length < 100) {
          throw new Error(`Downloaded image too small: ${imageBuffer.length} bytes`);
        }
        
      } catch (error) {
        console.error('Error downloading image from Google Drive:', error);
        throw new Error(`Failed to download image from Google Drive: ${error.message}`);
      }

      // Prepare post text with hashtags for photo post
      let postText = content;
      if (hashtags && hashtags.length > 0) {
        const hashtagText = hashtags.map(tag => 
          tag.startsWith('#') ? tag : `#${tag}`
        ).join(' ');
        postText = `${content}\n\n${hashtagText}`;
      }

      console.log('Final post text for photo:', postText.substring(0, 100) + '...');

      // Validate image size (Facebook limit is 10MB)
      if (imageBuffer.length > 10 * 1024 * 1024) {
        console.error(`Image too large: ${imageBuffer.length} bytes (limit: 10MB)`);
        throw new Error('Image file too large for Facebook (max 10MB)');
      }

      // Determine proper content type and filename
      let contentType = 'image/jpeg'; // Default to JPEG
      let filename = googleDriveFile.name || 'monkeyzoo_image.jpg';

      if (googleDriveFile.mimeType) {
        if (googleDriveFile.mimeType.includes('png')) {
          contentType = 'image/png';
        } else if (googleDriveFile.mimeType.includes('gif')) {
          contentType = 'image/gif';
        } else if (googleDriveFile.mimeType.includes('webp')) {
          contentType = 'image/webp';
        } else if (googleDriveFile.mimeType.includes('jpeg') || googleDriveFile.mimeType.includes('jpg')) {
          contentType = 'image/jpeg';
        }
      }

      console.log(`Final filename: ${filename}`);
      console.log(`Final content type: ${contentType}`);

      // Create form data for multipart upload
      const formData = new FormData();
      formData.append('message', postText);
      formData.append('access_token', userAccessToken);
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
          timeout: 60000
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
