/**
 * What this instance lets a visitor do (REQ251, REQ252), read from
 * `GET /api/instance-access` once per page load and shared by every surface
 * that asks — the sign-in dialog's "Create account" tab and the home page's
 * offer to keep this browser's decks (REQ194).
 *
 * Until the answer arrives, and after a failed read, every surface draws the
 * instance as open ({@link OPEN_INSTANCE_ACCESS}), which is how an instance
 * with neither switch set behaves. That default governs only what is drawn:
 * the server enforces each switch on its own routes, so a closed sign-up
 * refuses the request whatever the dialog showed. A failed read is forgotten,
 * so the next surface to mount tries again — the way `useLegalLinks()` loads
 * `GET /api/legal`.
 */

import { useEffect, useState } from "react";
import { api } from "./api";
import { type InstanceAccess, InstanceAccessSchema } from "./types";

/** What an instance with neither switch set reports. */
export const OPEN_INSTANCE_ACCESS: InstanceAccess = InstanceAccessSchema.parse(
	{},
);

let resolvedInstanceAccess: InstanceAccess | null = null;
let pendingInstanceAccess: Promise<InstanceAccess> | null = null;

function loadInstanceAccess(): Promise<InstanceAccess> {
	pendingInstanceAccess ??= api.getInstanceAccess().then(
		(access) => {
			resolvedInstanceAccess = access;
			return access;
		},
		() => {
			pendingInstanceAccess = null;
			return OPEN_INSTANCE_ACCESS;
		},
	);
	return pendingInstanceAccess;
}

export function useInstanceAccess(): InstanceAccess {
	const [access, setAccess] = useState<InstanceAccess>(
		() => resolvedInstanceAccess ?? OPEN_INSTANCE_ACCESS,
	);
	useEffect(() => {
		if (resolvedInstanceAccess) return;
		let mounted = true;
		void loadInstanceAccess().then((loaded) => {
			if (mounted) setAccess(loaded);
		});
		return () => {
			mounted = false;
		};
	}, []);
	return access;
}
