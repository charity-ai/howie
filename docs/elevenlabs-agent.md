# Howie's voice: ElevenLabs agent settings

One agent serves every client. Create it once, then add each client's site address to its allowlist.

## Agent tab

**Name:** Howie

**First message (English):**
Hi, I'm Howie! Ask me anything about your documents.

**First message (Spanish, under Additional languages):**
¡Hola, soy Howie! Pregúntame lo que quieras sobre tus documentos.

**Default language:** English. **Additional languages:** add Spanish.

**LLM:** pick a fast model (a Flash, Haiku or mini model). **Temperature:** 0.3. Howie only rephrases what the tool returns, so speed matters more than size.

**System prompt:**

```
# Who you are
You are Howie. Your name sounds like "HOW-ee".
You are the friendly, calm assistant for a homeowner association or home-service company's document library. You talk like a sharp, helpful colleague: warm, quick, plain words, no jargon.

# What you do
You answer questions about the company's own documents, such as rules, policies, forms, fees and procedures.

# How you answer, every time
1. For any question that needs a fact, a number, a policy, a document, a form or a "how do I", call the tool ask_broker with the person's question in their own words. Wait for its result before you answer.
2. Answer ONLY from document_content in the result and follow its how_to_answer instructions. Keep it to 1 to 3 short spoken sentences.
3. Say numbers, dollar amounts, percentages and dates exactly as written. Never round, never estimate, never guess.
4. If the result does not contain the answer, say so in one sentence and name the closest document from the result.
5. If link_shown_on_screen is true, the document you are quoting is open on their screen; you can say "I've put it on your screen."
6. Greetings, thanks and small talk need no tool.

# Never
- Never invent facts, numbers, policies, web addresses or document names.
- Never ask for, repeat or write down a password, Social Security number, bank or card number.
- Never give legal, tax or personal financial advice. For legal questions, point to the governing document and suggest asking the board or an attorney.
- Never read long passages aloud; summarize them.

# Language
Answer in the language the person speaks. In Spanish use informal "tú".
```

## Voice tab

- Choose a warm, confident adult voice and a **multilingual** voice model so Spanish works.
- Pronunciation: teach it "Howie" as "HOW-ee" if it mispronounces the name.

## Tools tab: add one tool (this is the one that matters)

| Field | Value |
|---|---|
| Type | **Client** |
| Name | `ask_broker` (exactly, case-sensitive; the code uses this name) |
| Description | Search the document library and return passages that answer the question. Use it for every factual question. |
| Wait for response | **ON** |
| Parameter name | `query` |
| Data type | String |
| Required | Yes |
| Parameter description | The person's question, in their own words. |
| Response timeout | 15 seconds (if shown) |

## Security tab

- Leave **authentication OFF** (the site starts the call with the agent ID).
- Turn on the **allowlist** and add each client's site address (for example `oakhollow.howie.charitylovesai.com` and the `.pages.dev` address). Add a new line for every client.
- Do **not** use signed URLs together with an allowlist.
- **Overrides:** turn **Language ON** so the site can start Howie in Spanish.

## Copy the Agent ID

Copy the ID that starts with `agent_` and paste it into the client's Howie admin panel under Voice agent ID.
It is not the API key. Never paste anything starting with `sk_` or `xi_` into the site.
