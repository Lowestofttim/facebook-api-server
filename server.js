const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Facebook API Server' });
});

app.post('/api/facebook/post', async (req, res) => {
  try {
    const { content, hashtags, pageId } = req.body;
    const userAccessToken = req.headers.authorization?.replace('Bearer ', '');

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (!userAccessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    // Prepare post text
    let postText = content;
    if (hashtags && hashtags.length > 0) {
      const hashtagText = hashtags.map(tag => 
        tag.startsWith('#') ? tag : `#${tag}`
      ).join(' ');
      postText = `${content}\n\n${hashtagText}`;
    }

    // Use pageId from request if provided, otherwise fall back to environment variable
    const targetPageId = pageId || process.env.FACEBOOK_PAGE_ID;
    
    if (!targetPageId) {
      return res.status(400).json({ error: 'Page ID is required (either in request or environment)' });
    }

    // Prepare form data for Facebook API (Facebook expects form-encoded data, not JSON)
    const params = new URLSearchParams();
    params.append('message', postText);
    params.append('access_token', userAccessToken);

    // Post to Facebook page using form-encoded data
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${targetPageId}/feed`,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    res.json({
      success: true,
      post_id: response.data.id,
      post_url: `https://facebook.com/${response.data.id}`,
      platform: 'Facebook'
    });

  } catch (error) {
    console.error('Facebook API Error:', error);
    res.status(500).json({
      error: 'Failed to post to Facebook',
      message: error.response?.data?.error?.message || error.message,
      facebookError: error.response?.data?.error // This helps Pipedream parse the error
    });
  }
});
