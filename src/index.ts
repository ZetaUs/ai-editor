/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const DEFAULT_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";

// Models the API is allowed to call. Requests may override the default
// through the `model` field, but only with an id listed here.
const ALLOWED_MODELS = [
	"@cf/qwen/qwen2.5-coder-32b-instruct",
	"@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	"@cf/mistralai/mistral-small-3.1-24b-instruct",
	"@cf/openai/gpt-oss-20b",
	"@cf/meta/llama-3.2-3b-instruct",
];

// Default system prompt
const SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/models") {
			return new Response(
				JSON.stringify({ default: DEFAULT_MODEL, models: ALLOWED_MODELS }),
				{
					headers: { "content-type": "application/json; charset=utf-8" },
				},
			);
		}

		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Runs a streaming text generation request for the given model.
 *
 * The model id arrives at runtime, so it cannot satisfy the literal-type
 * overloads of `Ai.run`. The signature is narrowed here once, which keeps the
 * rest of the handler fully typed as a `ReadableStream` response.
 */
async function runStream(
	env: Env,
	model: string,
	messages: ChatMessage[],
): Promise<ReadableStream> {
	const inputs: AiTextGenerationInput & { stream: true } = {
		messages,
		max_tokens: 1024,
		stream: true,
	};
	const run = (
		env.AI.run as unknown as (
			model: string,
			inputs: AiTextGenerationInput & { stream: true },
		) => Promise<ReadableStream>
	).bind(env.AI);
	return run(model, inputs);
}

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		// Parse JSON request body
		const body = (await request.json()) as {
			messages?: ChatMessage[];
			model?: string;
		};
		const messages = body.messages ?? [];
		const model =
			body.model && ALLOWED_MODELS.includes(body.model)
				? body.model
				: DEFAULT_MODEL;

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await runStream(env, model, messages);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		const detail =
			error instanceof Error
				? `${error.name}: ${error.message}`
				: String(error);
		return new Response(
			JSON.stringify({ error: "Failed to process request", detail }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}