import { afterEach } from "vitest";
import { resetDiscoveryRoutes } from "../discovery-routes.js";

// The "route not deployed" memo is per process; each test starts with none.
afterEach(() => {
  resetDiscoveryRoutes();
});
