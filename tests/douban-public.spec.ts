import { describe, expect, it } from "vitest";
import { fetchDoubanBaselineFromPublicPages, parseDoubanMusicPage, resolveDoubanUserId } from "../src/ingest/douban-public";

describe("parseDoubanMusicPage", () => {
  it("extracts title artist and tags from a public music page", () => {
    const html = `
      <div class="item comment-item">
        <div class="info">
          <ul>
            <li class="title">
              <a href="https://music.douban.com/subject/1401550/">
                <em>Back To Bedlam</em> / 不安於室
              </a>
            </li>
            <li class="intro">James Blunt / 2004 / Audio CD / 摇滚</li>
          </ul>
        </div>
      </div>
    `;

    expect(parseDoubanMusicPage(html, "collect")).toEqual([
      {
        title: "Back To Bedlam",
        artist: "James Blunt",
        tags: ["douban:collect", "摇滚"]
      }
    ]);
  });
});

describe("fetchDoubanBaselineFromPublicPages", () => {
  it("walks do wish collect pages and dedupes by artist plus title", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/do?")) {
        return new Response(
          `
            <div class="item comment-item"><div class="info"><ul>
              <li class="title"><a><em>Album A</em></a></li>
              <li class="intro">Artist A / 2010 / CD / 流行</li>
            </ul></div></div>
          `,
          { status: 200 }
        );
      }
      if (url.includes("/wish?")) {
        return new Response(
          `
            <div class="item comment-item"><div class="info"><ul>
              <li class="title"><a><em>Album B</em></a></li>
              <li class="intro">Artist B / 2011 / CD / 民谣</li>
            </ul></div></div>
          `,
          { status: 200 }
        );
      }
      return new Response(
        `
          <div class="item comment-item"><div class="info"><ul>
            <li class="title"><a><em>Album A</em></a></li>
            <li class="intro">Artist A / 2010 / CD / 流行</li>
          </ul></div></div>
        `,
        { status: 200 }
      );
    };

    const rows = await fetchDoubanBaselineFromPublicPages({
      userId: "sample_user_01",
      fetchFn
    });

    expect(rows).toEqual([
      { title: "Album A", artist: "Artist A", tags: ["douban:do", "流行"] },
      { title: "Album B", artist: "Artist B", tags: ["douban:wish", "民谣"] }
    ]);
  });
});

describe("resolveDoubanUserId", () => {
  it("reads douban user id from explicit id or profile url", () => {
    expect(resolveDoubanUserId({ DOUBAN_USER_ID: "sample_user_01" } as NodeJS.ProcessEnv)).toBe("sample_user_01");
    expect(
      resolveDoubanUserId({
        DOUBAN_PROFILE_URL: "https://www.douban.com/people/sample_user_01"
      } as NodeJS.ProcessEnv)
    ).toBe("sample_user_01");
  });
});
