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
    const { content, hashtags } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Prepare post text
    let postText = content;
    if (hashtags && hashtags.length > 0) {
      const hashtagText = hashtags.map(tag => 
        tag.startsWith('#') ? tag : `#${tag}`
      ).join(' ');
      postText = `${content}\n\n${hashtagText}`;
    }

    const pageId = process.env.FACEBOOK_PAGE_ID;
    const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;

    if (!pageId || !accessToken) {
      return res.status(500).json({ error: 'Facebook credentials not configured' });
    }

    // Post to Facebook
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${pageId}/feed`,
      {
        message: postText,
        access_token: accessToken
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
      message: error.response?.data?.error?.message || error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Facebook API Server running on port ${PORT}`);
});
