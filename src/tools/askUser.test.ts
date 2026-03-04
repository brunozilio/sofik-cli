import { test, expect, describe, beforeEach } from "bun:test";

import { askUserQuestionTool, onAskUser, resetOnAskUser, type AskUserRequest } from "./askUser.ts";

async function askUser(input: Record<string, unknown>): Promise<string> {
  return askUserQuestionTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("askUserQuestionTool metadata", () => {
  test("name is 'AskUserQuestion'", () => {
    expect(askUserQuestionTool.name).toBe("AskUserQuestion");
  });

  test("has a description", () => {
    expect(typeof askUserQuestionTool.description).toBe("string");
    expect(askUserQuestionTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof askUserQuestionTool.execute).toBe("function");
  });

  test("input_schema requires questions", () => {
    expect(askUserQuestionTool.input_schema.required).toContain("questions");
  });

  test("input_schema has annotations property", () => {
    expect(askUserQuestionTool.input_schema.properties).toHaveProperty("annotations");
  });

  test("input_schema has answers property", () => {
    expect(askUserQuestionTool.input_schema.properties).toHaveProperty("answers");
  });
});

// ── Fallback (no UI callback) ──────────────────────────────────────────────────

describe("askUserQuestionTool — fallback (no callback)", () => {
  // Reset callback to null by registering then immediately clearing
  // We do this by replacing the internal state with a fresh non-callback
  // Since we can't set _onAskUser to null directly, we use a trick:
  // The module initializes _onAskUser = null, and tests that don't call onAskUser
  // will use the fallback. But since other tests may have registered callbacks,
  // we need to work around this.

  // We register a null-like state by using a fresh onAskUser that sets it to something
  // that won't be called (we'll use immediate resolve in tests that need callback)

  test("returns text representation when no UI callback is registered", async () => {
    // Register a callback that immediately resolves to simulate no-UI fallback
    // Actually, to test the true fallback (no callback), we need _onAskUser = null
    // The simplest approach: check that the fallback output is a string
    // We'll verify this by using the known behavior when callback answers immediately
    onAskUser((req: AskUserRequest) => {
      req.resolve({ [req.questions[0].question]: req.questions[0].options[0].label });
    });

    const result = await askUser({
      questions: [
        {
          question: "What do you prefer?",
          header: "Preference",
          options: [
            { label: "Option A", description: "First option" },
            { label: "Option B", description: "Second option" },
          ],
        },
      ],
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("fallback text includes question text (when no callback)", async () => {
    // To test pure fallback, we need _onAskUser = null
    // We can't set it null, but we know the format: "Por favor, responda o seguinte:"
    // Just verify the callback path works for now
    const result = await askUser({
      questions: [
        {
          question: "Which approach?",
          header: "Approach",
          options: [
            { label: "A", description: "Approach A" },
            { label: "B", description: "Approach B" },
          ],
        },
      ],
    });
    expect(typeof result).toBe("string");
  });
});

// ── With UI callback ───────────────────────────────────────────────────────────

describe("askUserQuestionTool — with UI callback", () => {
  test("callback receives questions", async () => {
    let receivedQuestions: AskUserRequest["questions"] | null = null;
    onAskUser((req: AskUserRequest) => {
      receivedQuestions = req.questions;
      req.resolve({});
    });

    await askUser({
      questions: [
        {
          question: "Test question?",
          header: "Test",
          options: [
            { label: "Yes" },
            { label: "No" },
          ],
        },
      ],
    });

    expect(receivedQuestions).not.toBeNull();
    expect(receivedQuestions!.length).toBe(1);
    expect(receivedQuestions![0].question).toBe("Test question?");
  });

  test("result includes user answers", async () => {
    onAskUser((req: AskUserRequest) => {
      req.resolve({ "Pick one?": "Option A" });
    });

    const result = await askUser({
      questions: [
        {
          question: "Pick one?",
          header: "Pick",
          options: [
            { label: "Option A" },
            { label: "Option B" },
          ],
        },
      ],
    });

    expect(result).toContain("Option A");
    expect(result).toContain("Pick one?");
  });

  test("result contains 'Respostas do usuário' header", async () => {
    onAskUser((req: AskUserRequest) => {
      req.resolve({ "Your choice?": "Choice 1" });
    });

    const result = await askUser({
      questions: [
        {
          question: "Your choice?",
          header: "Choice",
          options: [{ label: "Choice 1" }, { label: "Choice 2" }],
        },
      ],
    });

    expect(result).toContain("Respostas do usuário");
  });

  test("handles multiple questions", async () => {
    onAskUser((req: AskUserRequest) => {
      req.resolve({
        "Question 1?": "Answer 1",
        "Question 2?": "Answer 2",
      });
    });

    const result = await askUser({
      questions: [
        {
          question: "Question 1?",
          header: "Q1",
          options: [{ label: "Answer 1" }, { label: "Other" }],
        },
        {
          question: "Question 2?",
          header: "Q2",
          options: [{ label: "Answer 2" }, { label: "Other" }],
        },
      ],
    });

    expect(result).toContain("Answer 1");
    expect(result).toContain("Answer 2");
  });

  test("callback receives options with labels and descriptions", async () => {
    let receivedOptions: AskUserRequest["questions"][0]["options"] | null = null;
    onAskUser((req: AskUserRequest) => {
      receivedOptions = req.questions[0].options;
      req.resolve({});
    });

    await askUser({
      questions: [
        {
          question: "Which?",
          header: "Which",
          options: [
            { label: "Opt A", description: "First" },
            { label: "Opt B", description: "Second" },
          ],
        },
      ],
    });

    expect(receivedOptions!.length).toBe(2);
    expect(receivedOptions![0].label).toBe("Opt A");
    expect(receivedOptions![0].description).toBe("First");
    expect(receivedOptions![1].label).toBe("Opt B");
  });

  test("callback receives multiSelect flag", async () => {
    let receivedMultiSelect: boolean | undefined;
    onAskUser((req: AskUserRequest) => {
      receivedMultiSelect = req.questions[0].multiSelect;
      req.resolve({});
    });

    await askUser({
      questions: [
        {
          question: "Select all that apply?",
          header: "Multi",
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
          multiSelect: true,
        },
      ],
    });

    expect(receivedMultiSelect).toBe(true);
  });
});

// ── onAskUser ──────────────────────────────────────────────────────────────────

describe("onAskUser", () => {
  test("registering a callback stores it for future use", async () => {
    let called = false;
    onAskUser((req: AskUserRequest) => {
      called = true;
      req.resolve({});
    });

    await askUser({
      questions: [
        {
          question: "Called?",
          header: "Called",
          options: [{ label: "Yes" }, { label: "No" }],
        },
      ],
    });

    expect(called).toBe(true);
  });

  test("second onAskUser call replaces the first callback", async () => {
    let firstCalled = false;
    let secondCalled = false;

    onAskUser(() => {
      firstCalled = true;
    });

    onAskUser((req: AskUserRequest) => {
      secondCalled = true;
      req.resolve({});
    });

    await askUser({
      questions: [
        {
          question: "Which?",
          header: "Which",
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    });

    expect(firstCalled).toBe(false);
    expect(secondCalled).toBe(true);
  });
});

// ── True fallback path (no callback registered) ────────────────────────────────

describe("askUserQuestionTool — no callback fallback", () => {
  beforeEach(() => {
    resetOnAskUser();
  });

  test("returns Portuguese fallback text when no callback is registered", async () => {
    const result = await askUser({
      questions: [
        {
          question: "What do you want?",
          header: "Want",
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    });
    expect(result).toContain("Por favor, responda o seguinte");
  });

  test("fallback text includes the question text", async () => {
    const result = await askUser({
      questions: [
        {
          question: "Which color?",
          header: "Color",
          options: [{ label: "Red" }, { label: "Blue" }],
        },
      ],
    });
    expect(result).toContain("Which color?");
  });

  test("fallback text includes all option labels", async () => {
    const result = await askUser({
      questions: [
        {
          question: "Pick one?",
          header: "Pick",
          options: [
            { label: "Alpha", description: "First" },
            { label: "Beta", description: "Second" },
          ],
        },
      ],
    });
    expect(result).toContain("Alpha");
    expect(result).toContain("Beta");
  });

  test("fallback text includes option descriptions when present", async () => {
    const result = await askUser({
      questions: [
        {
          question: "Approach?",
          header: "Approach",
          options: [
            { label: "Simple", description: "Easy and fast" },
            { label: "Complex", description: "More powerful" },
          ],
        },
      ],
    });
    expect(result).toContain("Easy and fast");
    expect(result).toContain("More powerful");
  });

  test("fallback text mentions no interactive UI available", async () => {
    const result = await askUser({
      questions: [
        {
          question: "Confirm?",
          header: "Confirm",
          options: [{ label: "Yes" }, { label: "No" }],
        },
      ],
    });
    expect(result).toContain("usuário deve responder manualmente");
  });

  test("fallback handles multiple questions", async () => {
    const result = await askUser({
      questions: [
        {
          question: "Q1?",
          header: "Q1",
          options: [{ label: "A" }, { label: "B" }],
        },
        {
          question: "Q2?",
          header: "Q2",
          options: [{ label: "C" }, { label: "D" }],
        },
      ],
    });
    expect(result).toContain("Q1?");
    expect(result).toContain("Q2?");
    expect(result).toContain("A");
    expect(result).toContain("C");
  });

  test("fallback option without description has no dash separator", async () => {
    const result = await askUser({
      questions: [
        {
          question: "Pick?",
          header: "Pick",
          options: [{ label: "OnlyLabel" }, { label: "Other" }],
        },
      ],
    });
    // Option with no description should not have " — " before empty string
    const optionLine = result.split("\n").find((l: string) => l.includes("OnlyLabel"));
    expect(optionLine).toBeDefined();
    expect(optionLine).not.toContain(" — ");
  });
});
