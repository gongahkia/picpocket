const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // For unique session IDs

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const { uniqueNamesGenerator, adjectives, animals, colors } = require('unique-names-generator'); 

// Store active sessions: sessionId -> { presenterWs: WebSocket, audienceWs: Set<WebSocket> }
const activeSessions = new Map();

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- HTTP Endpoints ---
// Presenter endpoint: Generates a new session and redirects to presenter.html with ID
app.get('/presenter', (req, res) => {
    // Replace uuidv4() with uniqueNamesGenerator
    const sessionId = uniqueNamesGenerator({
        dictionaries: [adjectives, animals, colors],
        separator: '-',
        style: 'lowerCase'
    });
    // Initialize session with null presenterWs and empty audience set
    activeSessions.set(sessionId, { presenterWs: null, audienceWs: new Set(), latestImage: null });
    console.log(`New session created: ${sessionId}`);
    // Redirect to the actual presenter HTML file with the session ID in the URL
    res.redirect(`/presenter.html?id=${sessionId}`);
});

// Audience join endpoint: Serves the audience HTML
app.get('/join/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || !activeSessions.has(sessionId)) {
        return res.status(404).send('Presentation session not found or invalid ID.');
    }
    res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

app.get('/healthz', (req, res) => res.send('ok'));

// --- WebSocket Handling ---
wss.on('connection', (ws, req) => {
    // Extract session ID and role from the URL path.
    // For presenter: /ws/presenter?id=SESSION_ID
    // For audience: /ws/audience?id=SESSION_ID
    const urlParts = req.url.split('?');
    const rolePath = urlParts[0]; // e.g., /ws/presenter or /ws/audience
    const urlParams = new URLSearchParams(urlParts[1]);

    const sessionId = urlParams.get('id');
    const role = rolePath.split('/')[2]; // 'presenter' or 'audience'

    if (!sessionId || !activeSessions.has(sessionId)) {
        console.log(`[WS] Connection rejected: Invalid session ID or not found: ${sessionId}`);
        ws.close();
        return;
    }

    const session = activeSessions.get(sessionId);

    if (role === 'presenter') {
        if (session.presenterWs) {
            console.log(`[WS] Presenter already connected for session ${sessionId}. Closing new connection.`);
            ws.close(); // Only one presenter per session
            return;
        }
        session.presenterWs = ws;
        console.log(`[WS] Presenter connected to session: ${sessionId}`);
    } else if (role === 'audience') {
        session.audienceWs.add(ws);
        console.log(`[WS] Audience connected to session: ${sessionId}. Total audience: ${session.audienceWs.size}`);
        if (session.latestImage) {
            try {
                ws.send(session.latestImage);
            } catch (e) {
                console.error(`[WS] Failed to send latest image to new audience:`, e);
            }
        }
    } else {
        console.log(`[WS] Unknown role: ${role}. Closing connection.`);
        ws.close();
        return;
    }

    ws.on('message', message => {
    // Only presenter sends messages (slide content)
    if (ws === session.presenterWs) {
        // --- THIS IS THE CRUCIAL CHANGE ---
        // Convert the Buffer 'message' back to a UTF-8 string
        const messageString = message.toString('utf8');

        // console.log(`[WS] Presenter for ${sessionId} sent: ${messageString.substring(0, 50)}...`); // Uncomment for verbose logging
        session.latestImage = messageString;

        // Broadcast the string message to all audience members in this session
        session.audienceWs.forEach(audienceWs => {
            if (audienceWs.readyState === WebSocket.OPEN) {
                audienceWs.send(messageString); // Send the string
            }
        });
    }
    });

    ws.on('close', () => {
        if (ws === session.presenterWs) {
            console.log(`[WS] Presenter disconnected from session: ${sessionId}. Closing audience connections.`);
            session.presenterWs = null; // Clear presenter
            // Notify audience that presenter disconnected and close their connections
            session.audienceWs.forEach(audienceWs => {
                if (audienceWs.readyState === WebSocket.OPEN) {
                    audienceWs.send(JSON.stringify({ type: 'disconnected', message: 'Presenter disconnected. Presentation ended.' }));
                    audienceWs.close();
                }
            });
            activeSessions.delete(sessionId); // Clean up session
            console.log(`[WS] Session ${sessionId} closed and cleaned up.`);
        } else if (session.audienceWs.has(ws)) {
            session.audienceWs.delete(ws);
            console.log(`[WS] Audience disconnected from session: ${sessionId}. Remaining audience: ${session.audienceWs.size}`);
            // If presenter is gone and last audience leaves, clean up too
            if (!session.presenterWs && session.audienceWs.size === 0) {
                 activeSessions.delete(sessionId);
                 console.log(`[WS] Session ${sessionId} (empty) closed and cleaned up.`);
            }
        }
    });

    ws.on('error', error => {
        console.error(`[WS] WebSocket error for session ${sessionId}, role ${role}:`, error);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`To start a presentation, open: http://localhost:${PORT}/presenter`);
});