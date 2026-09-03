import { ensureEventRunning } from "./setup";

export default async function globalSetup() {
  await ensureEventRunning();
}
