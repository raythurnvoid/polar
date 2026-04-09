import { describe, expect, test, vi } from "vitest";
import { Polar } from "./index.js";
import { anyApi, type ApiFromModules } from "convex/server";
import { components, initConvexTest } from "./setup.test.js";

const polarSdkMocks = vi.hoisted(() => ({
	checkoutsCreate: vi.fn(),
	customersCreate: vi.fn(),
	customersList: vi.fn(),
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

const polar = new Polar(components.polar, {
  getUserInfo: async () => ({
    userId: "user_123",
    email: "test@example.com",
  }),
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
				metadata: { userId: "user_123" },
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
