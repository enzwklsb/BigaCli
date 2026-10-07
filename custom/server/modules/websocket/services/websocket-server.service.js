import { WebSocket, WebSocketServer } from 'ws';
import { handleChatConnection } from '../../../modules/websocket/services/chat-websocket.service.js';
import { verifyWebSocketClient } from '../../../modules/websocket/services/websocket-auth.service.js';
import { handlePluginWsProxy } from '../../../modules/websocket/services/plugin-websocket-proxy.service.js';
import { handleShellConnection } from '../../../modules/websocket/services/shell-websocket.service.js';
import { handleDesktopNotificationsConnection } from '../../../modules/notifications/index.js';
/**
 * Used by this module's websocket gateway to keep active transports alive and
 * close half-open connections so their route-specific clients can reconnect.
 */
export function attachWebSocketHeartbeat(ws, intervalMs = 30_000, scheduler = {
    setInterval,
    clearInterval,
}) {
    let isAlive = true;
    let stopped = false;
    const markAlive = () => {
        isAlive = true;
    };
    const stopHeartbeat = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        scheduler.clearInterval(heartbeat);
        ws.off('pong', markAlive);
        ws.off('close', stopHeartbeat);
        ws.off('error', stopHeartbeat);
    };
    ws.on('pong', markAlive);
    ws.on('close', stopHeartbeat);
    ws.on('error', stopHeartbeat);
    const heartbeat = scheduler.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            return;
        }
        // A socket that did not answer the previous ping is half-open from the
        // server's perspective. Terminating it emits close and lets clients resume.
        if (!isAlive) {
            stopHeartbeat();
            ws.terminate();
            return;
        }
        isAlive = false;
        try {
            ws.ping();
        }
        catch {
            stopHeartbeat();
            ws.terminate();
        }
    }, intervalMs);
    return stopHeartbeat;
}
/**
 * Creates and wires the server-wide websocket gateway used for chat, shell, and
 * plugin proxy routes. Exported through the websocket module for server startup.
 */
export function createWebSocketServer(server, dependencies) {
    const wss = new WebSocketServer({
        server,
        verifyClient: ((info) => verifyWebSocketClient(info, dependencies.verifyClient)),
    });
    wss.on('connection', (ws, request) => {
        attachWebSocketHeartbeat(ws);
        const incomingRequest = request;
        const url = incomingRequest.url ?? '/';
        const pathname = new URL(url, 'http://localhost').pathname;
        if (pathname === '/remote-desktop' && dependencies.handleRemoteDesktop) {
            dependencies.handleRemoteDesktop(ws, incomingRequest);
            return;
        }
        if (pathname === '/shell') {
            handleShellConnection(ws, dependencies.shell);
            return;
        }
        if (pathname === '/ws') {
            handleChatConnection(ws, incomingRequest, dependencies.chat);
            return;
        }
        if (pathname === '/desktop-notifications') {
            handleDesktopNotificationsConnection(ws, incomingRequest);
            return;
        }
        if (pathname.startsWith('/plugin-ws/')) {
            handlePluginWsProxy(ws, pathname, dependencies.getPluginPort);
            return;
        }
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    });
    return wss;
}
//# sourceMappingURL=websocket-server.service.js.map
