import { describe, expect, test, vi } from "vitest";
import { Polar } from "./index.js";
import { anyApi, type ApiFromModules } from "convex/server";
import { components, initConvexTest } from "./setup.test.js";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import { convertToDatabaseSubscription } from "../component/util.js";

const polarSdkMocks = vi.hoisted(() => ({
	checkoutsCreate: vi.fn(),
	customersCreate: vi.fn(),
	customersList: vi.fn(),
	productsList: vi.fn(),
	validateEvent: vi.fn(),
}));

vi.mock("@polar-sh/sdk/funcs/checkoutsCreate.js", () => ({
	checkoutsCreate: polarSdkMocks.checkoutsCreate,
}));

vi.mock("@polar-sh/sdk/funcs/customersCreate.js", () => ({
	customersCreate: polarSdkMocks.customersCreate,
}));

vi.mock("@polar-sh/sdk/funcs/customersList.js", () => ({
	customersList: polarSdkMocks.customersList,
}));

vi.mock("@polar-sh/sdk/funcs/productsList.js", () => ({
	productsList: polarSdkMocks.productsList,
}));

vi.mock("@polar-sh/sdk/webhooks", () => ({
	WebhookVerificationError: class WebhookVerificationError extends Error {},
	validateEvent: polarSdkMocks.validateEvent,
}));

const polar = new Polar(components.polar, {
	getUserInfo: async () => ({
		userId: "user_123",
		email: "test@example.com",
	}),
	organizationToken: "polar_test_org_token",
});

const checkoutApi = polar.api();
export const generateCheckoutLink = checkoutApi.generateCheckoutLink;

const testApi = (
  anyApi as unknown as ApiFromModules<{
    "index.test": {
      generateCheckoutLink: typeof generateCheckoutLink;
    };
  }>
)["index.test"];

function createWebhookSubscription(
	overrides: Partial<Subscription & { priceId?: string | null }> = {},
): Subscription & { priceId?: string | null } {
	return {
		id: "sub_webhook",
		customerId: "cust_webhook",
		productId: "prod_webhook",
		checkoutId: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		modifiedAt: new Date("2026-01-02T00:00:00.000Z"),
		amount: 1000,
		currency: "eur",
		recurringInterval: "month",
		recurringIntervalCount: 1,
		status: "active",
		currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
		currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
		trialStart: null,
		trialEnd: null,
		cancelAtPeriodEnd: false,
		canceledAt: null,
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endsAt: null,
		endedAt: null,
		discountId: null,
		seats: null,
		customerCancellationReason: null,
		customerCancellationComment: null,
		metadata: {},
		customFieldData: {},
		pendingUpdate: null,
		priceId: "price_webhook",
		...overrides,
	} as Subscription & { priceId?: string | null };
}

describe("generateCheckoutLink", () => {
	test("passes externalId equal to userId when creating a new Polar customer", async () => {
		polarSdkMocks.customersList.mockResolvedValue({
			ok: true,
			value: { result: { items: [] } },
		});
		polarSdkMocks.customersCreate.mockResolvedValue({
			ok: true,
			value: { id: "cust_new_external_id" } as never,
		});
		polarSdkMocks.checkoutsCreate.mockResolvedValue({
			ok: true,
			value: { url: "https://checkout.polar.sh/session" },
		});

		const t = initConvexTest();
		await t.action(testApi.generateCheckoutLink, {
			productIds: ["prod_1"],
			origin: "https://example.com",
			successUrl: "https://example.com/success",
		});

		expect(polarSdkMocks.customersCreate).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				externalId: "user_123",
			}),
		);
	});

	test("appends locale as query param if provided", async () => {
		polarSdkMocks.customersList.mockResolvedValue({
			ok: true,
			value: { result: { items: [{ id: "cust_123" }] } },
		});
		polarSdkMocks.checkoutsCreate.mockResolvedValue({
			ok: true,
			value: { url: "https://checkout.polar.sh/session?foo=bar" },
		});

		const t = initConvexTest();
		const result = await t.action(testApi.generateCheckoutLink, {
			productIds: ["prod_1"],
			origin: "https://example.com",
			successUrl: "https://example.com/success",
			locale: "fr",
		});

		expect(result.url).toContain("locale=fr");
		expect(result.url).toMatch(/^https:\/\//);
	});

	test("does not append locale if not provided", async () => {
		polarSdkMocks.customersList.mockResolvedValue({
			ok: true,
			value: { result: { items: [{ id: "cust_123" }] } },
		});
		polarSdkMocks.checkoutsCreate.mockResolvedValue({
			ok: true,
			value: { url: "https://checkout.polar.sh/session?foo=bar" },
		});

		const t = initConvexTest();
		const result = await t.action(testApi.generateCheckoutLink, {
			productIds: ["prod_1"],
			origin: "https://example.com",
			successUrl: "https://example.com/success",
		});

		expect(result.url).not.toContain("locale=");
		expect(result.url).toMatch(/^https:\/\//);
	});
});

describe("registerRoutes", () => {
	test.each([
		"subscription.created",
		"subscription.updated",
		"subscription.active",
		"subscription.canceled",
		"subscription.uncanceled",
		"subscription.revoked",
		"subscription.past_due",
	] as const)("upserts local subscriptions for %s webhooks", async (eventType) => {
		const subscriptionId = `sub_${eventType.replace(".", "_")}`;
		polarSdkMocks.validateEvent.mockReturnValue({
			type: eventType,
			timestamp: new Date("2026-01-03T00:00:00.000Z"),
			data: createWebhookSubscription({
				id: subscriptionId,
				modifiedAt: new Date("2026-01-03T00:00:00.000Z"),
			}),
		});

		const t = initConvexTest();
		const response = await t.fetch("/polar/events", {
			method: "POST",
			body: JSON.stringify({ fake: true }),
		});

		const subscription = await t.query(components.polar.lib.getSubscription, {
			id: subscriptionId,
		});

		expect(response.status).toBe(202);
		expect(subscription?.id).toBe(subscriptionId);
		expect(subscription?.productId).toBe("prod_webhook");
	});

	test("persists and clears pendingUpdate from subscription webhook payloads", async () => {
		const t = initConvexTest();

		polarSdkMocks.validateEvent.mockReturnValue({
			type: "subscription.updated",
			timestamp: new Date("2026-01-03T00:00:00.000Z"),
			data: createWebhookSubscription({
				id: "sub_pending_update_route",
				modifiedAt: new Date("2026-01-03T00:00:00.000Z"),
				pendingUpdate: {
					id: "pending_update_route",
					createdAt: new Date("2026-01-03T00:00:00.000Z"),
					modifiedAt: null,
					appliesAt: new Date("2026-02-01T00:00:00.000Z"),
					productId: "prod_next_route",
					seats: null,
				},
			}),
		});
		await t.fetch("/polar/events", {
			method: "POST",
			body: JSON.stringify({ fake: true }),
		});

		const scheduledSubscription = await t.query(components.polar.lib.getSubscription, {
			id: "sub_pending_update_route",
		});
		expect(scheduledSubscription?.pendingUpdate).toEqual({
			id: "pending_update_route",
			appliesAt: "2026-02-01T00:00:00.000Z",
			productId: "prod_next_route",
			seats: null,
		});

		polarSdkMocks.validateEvent.mockReturnValue({
			type: "subscription.updated",
			timestamp: new Date("2026-01-04T00:00:00.000Z"),
			data: createWebhookSubscription({
				id: "sub_pending_update_route",
				modifiedAt: new Date("2026-01-04T00:00:00.000Z"),
				pendingUpdate: null,
			}),
		});
		await t.fetch("/polar/events", {
			method: "POST",
			body: JSON.stringify({ fake: true }),
		});

		const subscription = await t.query(components.polar.lib.getSubscription, {
			id: "sub_pending_update_route",
		});

		expect(subscription?.pendingUpdate).toBeNull();
	});

	test("removes local customer mapping for customer.deleted webhooks", async () => {
		const t = initConvexTest();
		await t.mutation(components.polar.lib.insertCustomer, {
			id: "cust_deleted_route",
			userId: "user_deleted_route",
		});
		await t.mutation(components.polar.lib.createSubscription, {
			subscription: convertToDatabaseSubscription(
				createWebhookSubscription({
					id: "sub_deleted_route",
					customerId: "cust_deleted_route",
				}),
			),
		});

		polarSdkMocks.validateEvent.mockReturnValue({
			type: "customer.deleted",
			timestamp: new Date("2026-01-03T00:00:00.000Z"),
			data: {
				id: "cust_deleted_route",
			},
		});
		const response = await t.fetch("/polar/events", {
			method: "POST",
			body: JSON.stringify({ fake: true }),
		});

		const customer = await t.query(components.polar.lib.getCustomerByUserId, {
			userId: "user_deleted_route",
		});
		const subscriptions = await t.query(components.polar.lib.listCustomerSubscriptions, {
			customerId: "cust_deleted_route",
		});

		expect(response.status).toBe(202);
		expect(customer).toBeNull();
		expect(subscriptions.map((subscription) => subscription.id)).toEqual(["sub_deleted_route"]);
	});

	test("triggers a full product sync when a benefit is updated", async () => {
		polarSdkMocks.validateEvent.mockReturnValue({
			type: "benefit.updated",
			data: {
				id: "benefit_123",
			},
		});
		polarSdkMocks.productsList.mockResolvedValue({
			ok: true,
			value: {
				result: {
					items: [],
					pagination: {
						maxPage: 1,
					},
				},
			},
		});

		const t = initConvexTest();
		const response = await t.fetch("/polar/events", {
			method: "POST",
			body: JSON.stringify({ fake: true }),
		});

		expect(response.status).toBe(202);
		expect(polarSdkMocks.productsList).toHaveBeenCalledTimes(1);
		expect(polarSdkMocks.productsList).toHaveBeenCalledWith(expect.anything(), {
			page: 1,
			limit: 100,
		});
	});
});
