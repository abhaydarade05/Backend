import 'dotenv/config';
import app from './app.js';
import { connectToDatabase } from './database.js';

const port = Number(process.env.PORT || 5000);

connectToDatabase()
  .then(() => app.listen(port, () => console.log(`Complaint Management API listening on port ${port}.`)))
  .catch(error => {
    console.error('Failed to start the API:', error.message);
    process.exitCode = 1;
  });
