/**
 * The one constant `cli/` restates instead of importing.
 *
 * `cli/protocol.ts` carries its own copy of the edit-token header name so that
 * the directory imports nothing outside itself and the flake can build the
 * executable offline, from source, with nothing but Bun. That duplication is
 * only safe while the two copies agree, and this is what makes them agree: the
 * test — which runs with `node_modules` present and may therefore import the
 * server — reads the server's own constant and compares.
 *
 * If this fails, the header was renamed on the server side and every mutation
 * this client authorizes with an edit token is about to start answering `401`.
 */

import { describe, expect, test } from "bun:test";
import { EDIT_TOKEN_HEADER as SERVER_EDIT_TOKEN_HEADER } from "../server/schemas";
import { EDIT_TOKEN_HEADER } from "./protocol";

describe("the wire vocabulary", () => {
	test("the client's edit-token header is the server's", () => {
		expect(EDIT_TOKEN_HEADER).toBe(SERVER_EDIT_TOKEN_HEADER);
	});
});
