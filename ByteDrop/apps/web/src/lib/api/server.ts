import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, DEMO } from "../config";
import { handleDemo } from "../demo/router";
import { ApiError, buildUrl, parseResponse } from "./client";
import { createApi, type Requester } from "./endpoints";

/** Server-component requester: forwards the visitor's session cookie to the API (or reads demo data directly). */
export const serverRequest: Requester = async (method, path, opts) => {
  const url = buildUrl(path, opts?.query);
  if (DEMO) {
    const r = handleDemo(method, url, opts?.body);
    return parseResponse(
      new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status }),
      opts?.schema,
    ) as never;
  }
  const cookie = (await cookies()).toString();
  const res = await fetch(`${API_URL}${url}`, {
    method,
    cache: "no-store",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(opts?.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return parseResponse(res, opts?.schema) as never;
};

export const serverApi = createApi(serverRequest);

/** Runs a server-side API call; an expired session sends the visitor to the sign-in page. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/login");
    throw err;
  }
}
