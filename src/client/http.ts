import { componentsGeneric, httpRouter } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { Polar } from "./index.js";

const components = componentsGeneric() as unknown as {
	polar: ComponentApi;
};

const polar = new Polar(components.polar, {
	getUserInfo: async () => ({
		userId: "user_123",
		email: "test@example.com",
	}),
	organizationToken: "polar_test_org_token",
});

const http = httpRouter();
polar.registerRoutes(http);

export default http;
