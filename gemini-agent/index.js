
const express = require('express');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
app.use(express.json());

const MINIVERSE_SERVER_URL = process.env.MINIVERSE_SERVER_URL || 'http://localhost:4321';
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

if (!GOOGLE_GEMINI_API_KEY) {
    console.error('GOOGLE_GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GOOGLE_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro"});

// Placeholder for Miniverse agent actions
const sendHeartbeat = async (agentId, state) => {
    try {
        const response = await fetch(`${MINIVERSE_SERVER_URL}/api/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ agent: agentId, state: state }),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        console.log(`Heartbeat sent for ${agentId} with state ${state}`);
    } catch (error) {
        console.error(`Error sending heartbeat for ${agentId}:`, error);
    }
};

// Route to handle Miniverse agent commands (e.g., chat messages, interactive actions)
app.post('/miniverse-agent', async (req, res) => {
    const { agentId, command, payload } = req.body;
    console.log(`Received command for ${agentId}: ${command} with payload:`, payload);

    let responseToMiniverse = { agentId: agentId, action: 'idle' };

    try {
        if (command === 'chat') {
            const prompt = payload.message;
            const result = await model.generateContent(prompt);
            const geminiResponse = await result.response;
            const text = geminiResponse.text();

            console.log('Gemini Response:', text);

            responseToMiniverse.action = 'chat';
            responseToMiniverse.message = text;
        }
        // Add other command handlers as needed
    } catch (error) {
        console.error('Error interacting with Gemini API:', error);
        responseToMiniverse.action = 'error';
        responseToMiniverse.message = 'Error communicating with Gemini.';
    }

    res.json(responseToMiniverse);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Gemini Miniverse Agent listening on port ${PORT}`);
    console.log(`Miniverse Server URL: ${MINIVERSE_SERVER_URL}`);
    console.log('Remember to set GOOGLE_GEMINI_API_KEY in your .env file.');

    // Example heartbeat for this agent after server starts
    // In a real scenario, this would be part of a more robust agent lifecycle management
    const agentId = 'gemini-miniverse-agent';
    sendHeartbeat(agentId, 'active');
});
