import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { GET } from "./api/spherex.js";

// Runs the Vercel function on the dev and preview servers too.
function localApi() {
  const mount = (server) => {
    server.middlewares.use("/api/spherex", async (req, res) => {
      const response = await GET(new Request(`http://localhost${req.originalUrl}`));
      res.statusCode = response.status;
      res.setHeader("content-type", response.headers.get("content-type"));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  };
  return { name: "local-api", configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  plugins: [react(), localApi()],
});
