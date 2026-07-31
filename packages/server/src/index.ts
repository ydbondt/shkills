import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`  Shkills — share skills`);
  console.log(`  portal   ${config.publicUrl}`);
  console.log(`  install  curl -fsSL ${config.publicUrl}/install.sh | sh`);
  console.log(`  data     ${config.dbPath}`);
});
