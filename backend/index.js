const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/videos', express.static(path.join(__dirname, 'videos')));

// Routes
app.use('/api/generate', require('./routes/generate'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running successfully' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
