const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Hello dosto 😊🙂</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        html, body { height: 100dvh; width: 100vw; margin: 0; padding: 0; overflow: hidden; font-family: sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        .whatsapp-wallpaper { background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); background-repeat: repeat; }
    </style>
</head>
<body class="bg-[#efeae2] flex justify-center items-center">
    <div class="w-full max-w-2xl h-full bg-[#efeae2] flex flex-col relative shadow-2xl overflow-hidden">
        <div class="bg-[#00a884] text-white px-3 py-2.5 flex items-center justify-between shadow-md z-30 shrink-0">
            <div class="flex items-center space-x-2.5">
                <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-xl">👥</div>
                <div>
                    <h1 class="font-bold text-base">Hello dosto 😊🙂</h1>
                    <p class="text-[11px] text-green-100">लाइव चैट कनेक्टेड</p>
                </div>
            </div>
        </div>
        <div id="messagesContainer" class="flex-1 p-3 overflow-y-auto space-y-2.5 flex flex-col whatsapp-wallpaper">
            <div class="bg-[#fff3c4] text-gray-800 self-center text-[11px] px-3 py-1 rounded-lg shadow-sm text-center">
                ✨ स्वागत है! यहाँ आप और आपके दोस्त लाइव चैट कर सकते हैं।
            </div>
        </div>
        <div class="bg-[#f0f2f5] p-2 flex items-end space-x-1.5 z-20 border-t border-gray-200 shrink-0">
            <textarea id="messageInput" rows="1" placeholder="संदेश लिखें..." class="flex-1 bg-white text-gray-800 rounded-2xl px-3.5 py-2.5 text-sm focus:outline-none border border-gray-300 resize-none"></textarea>
            <button onclick="sendMessage()" class="bg-[#00a884] text-white w-11 h-11 rounded-full flex items-center justify-center text-lg">➤</button>
        </div>
    </div>
    <script>
        const socket = io();
        let myName = prompt("चैट में जुड़ने के लिए अपना नाम लिखें:") || "User_" + Math.floor(Math.random()*1000);

        socket.on('receive_message', (data) => {
            renderMsg(data);
        });

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            if(!text) return;
            socket.emit('send_message', { sender: myName, text: text });
            input.value = '';
        }

        function renderMsg(data) {
            const container = document.getElementById('messagesContainer');
            const div = document.createElement('div');
            const isMe = data.sender === myName;
            div.className = \`max-w-[80%] px-3 py-2 rounded-xl text-sm shadow-sm \${isMe ? 'bg-[#dcf8c6] self-end' : 'bg-white self-start'}\`;
            div.innerHTML = \`<b class="text-xs text-[#075e54]">\${data.sender}</b><p>\${data.text}</p>\`;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }
    </script>
</body>
</html>`);
});

io.on('connection', (socket) => {
    socket.on('send_message', (data) => {
        io.emit('receive_message', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
