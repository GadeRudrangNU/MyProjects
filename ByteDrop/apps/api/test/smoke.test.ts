import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, makeImage, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

describe("smoke", () => {
  it("health, ready, signup and a full upload/download round trip", async () => {
    expect((await env.app.inject("/health")).json()).toEqual({ status: "ok" });
    expect((await env.app.inject("/ready")).statusCode).toBe(200);

    const { cookie, project } = await env.setupProject();
    await env.createBucket(cookie, project.id, "assets-bucket", true);
    const png = await makeImage(100, 80);
    const up = await env.upload(env.as(cookie), project.id, "assets-bucket", "pics/a.png", png, "image/png");
    expect(up.statusCode).toBe(201);

    const res = await env.app.inject("/f/assets-bucket/pics/a.png");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.equals(png)).toBe(true);
  });
});
