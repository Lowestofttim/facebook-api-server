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
    if (logBody.facebook_access_token) {
      logBody.facebook_access_token = '[ACCESS_TOKEN_HIDDEN]';
    }
    console.log('Request body:', JSON.stringify(logBody, null, 2));
  }
  next();
});

app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ status: 'OK', service: 'Facebook & Threads API Server' });
});

// Facebook endpoint
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
      console.log('Processing image post - uploading photo first, then posting to feed...');
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

      // Step 1: Upload the photo to get a photo ID
      console.log('Step 1: Uploading photo to Facebook...');
      
      const photoFormData = new FormData();
      photoFormData.append('access_token', userAccessToken);
      photoFormData.append('published', 'false'); // Don't publish the photo directly
      photoFormData.append('source', imageBuffer, {
        filename: googleDriveFile.name || 'monkeyzoo_image.jpg',
        contentType: googleDriveFile.mimeType || 'image/jpeg'
      });

      const photoResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${targetPageId}/photos`,
        photoFormData,
        {
          headers: {
            ...photoFormData.getHeaders()
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000
        }
      );

      console.log('Photo upload SUCCESS:', photoResponse.data);
      const photoId = photoResponse.data.id;

      // Step 2: Create a feed post with the uploaded photo
      console.log('Step 2: Creating feed post with uploaded photo...');
      
      // Prepare post text with hashtags
      let postText = content;
      if (hashtags && hashtags.length > 0) {
        const hashtagText = hashtags.map(tag => 
          tag.startsWith('#') ? tag : `#${tag}`
        ).join(' ');
        postText = `${content}\n\n${hashtagText}`;
      }

      const feedFormData = new URLSearchParams();
      feedFormData.append('message', postText);
      feedFormData.append('attached_media[0]', `{"media_fbid":"${photoId}"}`);
      feedFormData.append('access_token', userAccessToken);

      const feedResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${targetPageId}/feed`,
        feedFormData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      console.log('Feed post SUCCESS:', feedResponse.data);

      res.json({
        success: true,
        post_id: feedResponse.data.id,
        post_url: `https://facebook.com/${feedResponse.data.id}`,
        platform: 'Facebook',
        endpoint_used: 'feed_with_photo',
        image_uploaded: true,
        photo_id: photoId,
        image_info: {
          filename: googleDriveFile.name,
          size: imageBuffer.length,
          contentType: googleDriveFile.mimeType
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

// Threads endpoint
app.post('/api/threads/post', async (req, res) => {
  console.log('=== Threads POST request received ===');
  
  try {
    const { characterName, content, imageFile } = req.body;
    
    // For Threads, we'll use the same Facebook access token since Threads is owned by Meta
    // You'll need to pass the access token in the Authorization header
    const threadsAccessToken = req.headers.authorization?.replace('Bearer ', '');

    console.log('Parsed Threads request data:', {
      characterName: characterName,
      content: content ? `${content.substring(0, 50)}...` : 'MISSING',
      hasImageFile: !!imageFile,
      hasToken: !!threadsAccessToken
    });

    if (!characterName) {
      console.log('ERROR: Character name is missing');
      return res.status(400).json({ error: 'Character name is required' });
    }

    if (!content) {
      console.log('ERROR: Content is missing');
      return res.status(400).json({ error: 'Content is required' });
    }

    if (!imageFile || !imageFile.id) {
      console.log('ERROR: Image file information is missing');
      return res.status(400).json({ error: 'Image file information is required' });
    }

    if (!threadsAccessToken) {
      console.log('ERROR: Threads access token is missing');
      return res.status(400).json({ error: 'Threads access token is required' });
    }

    console.log('Starting Threads posting process...');
    console.log(`Character: ${characterName}`);
    console.log(`Image file: ${imageFile.name} (${imageFile.id})`);

    // Download image from Google Drive
    let imageBuffer;
    try {
      console.log(`Downloading image from Google Drive: ${imageFile.id}`);
      
      // Download the image directly from Google Drive using public URL
      const downloadUrl = `https://drive.google.com/uc?export=download&id=${imageFile.id}`;
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

    // Step 1: Create Threads media container
    console.log('Step 1: Creating Threads media container...');
    
    const mediaFormData = new URLSearchParams();
    mediaFormData.append('image_url', `https://drive.google.com/uc?export=download&id=${imageFile.id}`);
    mediaFormData.append('text', content);
    mediaFormData.append('access_token', threadsAccessToken);

    // Note: Threads uses a different user ID format - you'll need to get your Threads user ID
    // For now, we'll use a placeholder and you'll need to provide your actual Threads user ID
    const threadsUserId = process.env.THREADS_USER_ID || 'YOUR_THREADS_USER_ID';

    const mediaResponse = await axios.post(
      `https://graph.threads.net/v1.0/${threadsUserId}/threads`,
      mediaFormData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 60000
      }
    );

    console.log('Threads media container SUCCESS:', mediaResponse.data);
    const mediaContainerId = mediaResponse.data.id;

    // Step 2: Publish the Threads media container
    console.log('Step 2: Publishing Threads media container...');
    
    const publishFormData = new URLSearchParams();
    publishFormData.append('creation_id', mediaContainerId);
    publishFormData.append('access_token', threadsAccessToken);

    const publishResponse = await axios.post(
      `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`,
      publishFormData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000
      }
    );

    console.log('Threads publish SUCCESS:', publishResponse.data);

    res.json({
      success: true,
      post_id: publishResponse.data.id,
      post_url: `https://threads.net/@${characterName.toLowerCase()}/post/${publishResponse.data.id}`,
      platform: 'Threads',
      endpoint_used: 'threads_publish',
      image_uploaded: true,
      media_container_id: mediaContainerId,
      threads_user_id: threadsUserId,
      character_name: characterName,
      content: content,
      image_info: {
        filename: imageFile.name,
        google_drive_id: imageFile.id,
        size: imageBuffer.length
      }
    });

  } catch (error) {
    console.error('=== Threads API Error ===');
    console.error('Error message:', error.message);
    console.error('Error response status:', error.response?.status);
    console.error('Error response data:', error.response?.data);
    console.error('Full error:', error);
    
    res.status(500).json({
      error: 'Failed to post to Threads',
      message: error.response?.data?.error?.message || error.message,
      threadsError: error.response?.data?.error
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Facebook & Threads API Server running on port ${PORT}`);
});
