const fs = require("node:fs");
    const path = require("node:path");
    const oldBridge = ["https://automate", "make.replit.app"].join("-");
    const railwayBridge = process.env.BRIDGE_URL || process.env.MAILBOX_BRIDGE_URL || "https://workspaceapi-server-production-0f24.up.railway.app";
    const serverPath = path.join(__dirname, "server.js");
    const publicPath = path.join(__dirname, "public", "index.html");
    const oldDeclaration = `const REPLIT_API  = '${oldBridge}';`;
    const configurableDeclaration = `const REPLIT_API  = (
  process.env.BRIDGE_URL ||
  process.env.MAILBOX_BRIDGE_URL ||
  'https://workspaceapi-server-production-0f24.up.railway.app'
).replace(/\/+$/, '');`;
    let server = fs.readFileSync(serverPath, "utf8");
    if (server.includes(oldDeclaration)) server = server.replace(oldDeclaration, configurableDeclaration);
    if (server.includes(oldBridge)) throw new Error("server.js conserva el dominio histórico del puente");
    fs.writeFileSync(serverPath, server, "utf8");
    let publicHtml = fs.readFileSync(publicPath, "utf8");
    publicHtml = publicHtml.replaceAll(oldBridge, railwayBridge.replace(/\/+$/, ""));
    if (publicHtml.includes(oldBridge)) throw new Error("public/index.html conserva el dominio histórico del puente");
    fs.writeFileSync(publicPath, publicHtml, "utf8");
    console.log("Puente Railway configurado antes del arranque");
    