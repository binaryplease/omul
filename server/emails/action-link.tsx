/**
 * The "click this link to do a thing" email body — password reset and email
 * verification are the same layout (heading, lead paragraph, CTA button, a
 * paste-able link fallback, and a footer note) differing only in their copy and
 * the target URL. That layout is the invariant, so it is one prop-driven
 * component (ADR-0027) rather than two near-identical templates.
 */

import { Button, Heading, Link, Section, Text } from "@react-email/components";
import type { ReactElement } from "react";
import { EmailShell } from "./shell";
import { theme } from "./theme";

export interface ActionLinkEmailProps {
	// Inbox preview line (preheader).
	preheader: string;
	// The mono, wide-tracked category kicker above the heading.
	eyebrow: string;
	// The card heading.
	heading: string;
	// The explanatory paragraph under the heading.
	lead: string;
	// The CTA button label.
	buttonLabel: string;
	// Where the button and the paste-able fallback link point.
	url: string;
	// The reassuring footer note ("if you didn't request this…").
	footer: string;
}

export function ActionLinkEmail({
	preheader,
	eyebrow,
	heading,
	lead,
	buttonLabel,
	url,
	footer,
}: ActionLinkEmailProps): ReactElement {
	return (
		<EmailShell preheader={preheader} eyebrow={eyebrow}>
			<Heading style={theme.heading}>{heading}</Heading>
			<Text style={theme.lead}>{lead}</Text>
			<Section>
				<Button href={url} style={theme.button}>
					{buttonLabel}
				</Button>
			</Section>
			<Text style={theme.fineprint}>
				Button not working? Copy and paste this link:
			</Text>
			<Section style={theme.linkBox}>
				<Text style={theme.pasteLink}>
					<Link href={url} style={theme.anchor}>
						{url}
					</Link>
				</Text>
			</Section>
			<Text style={theme.footer}>{footer}</Text>
		</EmailShell>
	);
}
