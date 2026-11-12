import { describe, expect, it } from "vitest";
import { commands, pingCommand, aboutCommand } from "../src/commands/index.js";

describe("Slash Commands", () => {
  it("registers ping and about commands", () => {
    expect(commands).toContain(pingCommand);
    expect(commands).toContain(aboutCommand);
  });

  it("ensures ping command structure is valid", () => {
    expect(pingCommand.data.name).toBe("ping");
    expect(typeof pingCommand.data.description).toBe("string");
    expect(typeof pingCommand.execute).toBe("function");
  });

  it("ensures about command structure is valid", () => {
    expect(aboutCommand.data.name).toBe("about");
    expect(typeof aboutCommand.data.description).toBe("string");
    expect(typeof aboutCommand.execute).toBe("function");
  });
});
