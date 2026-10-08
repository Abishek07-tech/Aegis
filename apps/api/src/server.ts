import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[aegis-api] running on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
