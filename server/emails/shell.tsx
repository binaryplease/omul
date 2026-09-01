/**
 * The outer chrome shared by every transactional email — the brand shell.
 *
 * The one true invariant across all the omul emails is this frame (the
 * self-contained brand card — accent top edge, dark masthead with the omul
 * wordmark, content region, sign-off), so it is factored into a single shared
 * wrapper (ADR-0027) that each template composes; the templates only vary the
 * body inside the card. `preheader` is the inbox preview line email clients show
 * next to the subject — a React Email `<Preview>` renders it as hidden text.
 *
 * Note: the surrounding `<Body>` deliberately sets NO background colour — see the
 * requirement documented on `theme.body` in ./theme.ts. The brand identity lives
 * entirely inside the card so it survives whatever padded chrome the client adds.
 */

import {
	Body,
	Container,
	Head,
	Html,
	Preview,
	Section,
	Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { theme } from "./theme";

export interface EmailShellProps {
	// The inbox preview text (preheader) shown beside the subject line.
	preheader: string;
	// Optional mono, wide-tracked category kicker rendered above the card body's
	// heading — the brand's label treatment, shared by every template that wants
	// the kicker → headline → body prose hierarchy (ADR-0026: one shared wrapper).
	eyebrow?: string;
	children: ReactNode;
}

// Pull the app's brand faces where the client honours web fonts (e.g. Apple
// Mail); everything else falls through to the system stacks in `theme`.
const fontImport = `@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');`;

export function EmailShell({ preheader, eyebrow, children }: EmailShellProps) {
	return (
		<Html lang="en">
			<Head>
				<style
					// static, no interpolation
					dangerouslySetInnerHTML={{ __html: fontImport }}
				/>
			</Head>
			<Preview>{preheader}</Preview>
			<Body style={theme.body}>
				<Container style={theme.outer}>
					<Section style={theme.card}>
						<Section style={theme.cardHeader}>
							<span style={theme.brandWord}>omul</span>
							<span style={theme.brandTagline}>live presentations</span>
						</Section>
						<Section style={theme.cardBody}>
							{eyebrow ? <Text style={theme.eyebrow}>{eyebrow}</Text> : null}
							{children}
						</Section>
					</Section>
					<Text style={theme.signoff}>omul · live presentations</Text>
				</Container>
			</Body>
		</Html>
	);
}
