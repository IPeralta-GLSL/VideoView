trap "kill 0" SIGINT
npm run dev &
node server.js
