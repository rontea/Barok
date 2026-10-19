import dotenv from 'dotenv';
dotenv.config();

const key = process.env.POLLINATIONS_API_KEY;

async function getModels() {
  try {
    // Get image models
    const imgRes = await fetch('https://gen.pollinations.ai/image/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    const imgData = await imgRes.json();
    console.log('Image Models:', imgData);
    
    // Get text models
    const txtRes = await fetch('https://gen.pollinations.ai/text/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    const txtData = await txtRes.json();
    console.log('Text Models:', txtData);
  } catch (e) {
    console.error('Error:', e);
  }
}

getModels();
