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

    // Post to Facebook page
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${targetPageId}/feed`,
      {
        message: postText,
        access_token: userAccessToken
      }
    );

    res.json({
      success: true,
      postId: response.data.id,
      platform: 'Facebook',
      url: `https://facebook.com/${response.data.id}`
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Facebook API Server running on port ${PORT}`);
});
