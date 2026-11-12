import { describe, expect, it } from "vitest";
import { commands, pingCommand, aboutCommand, panelCommand } from "../src/commands/index.js";

describe("Slash Commands", () => {
  it("registers ping, about, and panel commands", () => {
    expect(commands).toContain(pingCommand);
    expect(commands).toContain(aboutCommand);
    expect(commands).toContain(panelCommand);
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

  it("ensures panel command structure is valid with subcommands", () => {
    expect(panelCommand.data.name).toBe("panel");
    expect(typeof panelCommand.data.description).toBe("string");
    expect(typeof panelCommand.execute).toBe("function");
    expect(typeof panelCommand.autocomplete).toBe("function");

    const json = panelCommand.data.toJSON();
    const subcommands = json.options?.map((opt) => opt.name) ?? [];
    expect(subcommands).toContain("connect");
    expect(subcommands).toContain("disconnect");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("status");
    expect(subcommands).toContain("settings");
  });
});
