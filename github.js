/**
 * github.js — GitHub GraphQL client + stat computation.
 * Works in three auth modes:
 *   proxy   : POST /graphql on the same origin (token lives in .env, safest)
 *   browser : direct https://api.github.com/graphql with a token from localStorage
 */
(function () {
  "use strict";

  const GITHUB_GRAPHQL = "https://api.github.com/graphql";

  const PROFILE_QUERY = `query($login: String!) {
    user(login: $login) {
      name
      login
      avatarUrl
      bio
      url
      followers { totalCount }
      following { totalCount }
      repositories(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes {
          name
          stargazerCount
          forkCount
          pushedAt
          primaryLanguage { name color }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestReviewContributions
        totalIssueContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              level
            }
          }
        }
      }
    }
  }`;

  /**
   * Fetch profile data via GraphQL. auth: { mode:'proxy' } | { mode:'browser', token }
   * Returns { profile, stats } or throws { code, message }.
   */
  async function fetchProfile(login, auth) {
    const variables = { login: String(login).trim().replace(/^@/, "") };
    const body = JSON.stringify({ query: PROFILE_QUERY, variables });

    let res, json;
    if (auth.mode === "proxy") {
      res = await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      json = await res.json();
      if (json && json.code === "NO_TOKEN") {
        throw { code: "NO_TOKEN", message: "Proxy has no token in .env" };
      }
    } else {
      res = await fetch(GITHUB_GRAPHQL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth.token,
        },
        body,
      });
      json = await res.json();
    }

    if (json.errors && json.errors.length) {
      const err = json.errors[0];
      const code = /Bad credentials|401/i.test(err.message || "") ? "BAD_TOKEN" : "GRAPHQL";
      throw { code, message: err.message || "GraphQL error" };
    }
    if (!json.data || !json.data.user) {
      throw { code: "NOT_FOUND", message: "User not found on GitHub" };
    }
    return buildStats(json.data.user);
  }

  /* ---------- stat computation ---------- */
  function buildStats(user) {
    const cal = user.contributionsCollection.contributionCalendar;
    const days = [];
    for (const week of cal.weeks) {
      for (const d of week.contributionDays) {
        days.push(d); // chronological (oldest -> newest)
      }
    }
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);

    const countSince = (n) => {
      const cutoff = fmt(new Date(today.getTime() - n * 86400000));
      return days.filter((d) => d.date >= cutoff).reduce((a, d) => a + d.contributionCount, 0);
    };

    // streaks
    let current = 0, longest = 0, run = 0;
    const yday = new Date(today.getTime() - 86400000);
    const dayMap = new Map(days.map((d) => [d.date, d]));
    // current streak: count backwards from today (today may be 0)
    let cursor = today;
    if (!dayMap.has(fmt(cursor))) cursor = yday;
    while (dayMap.has(fmt(cursor)) && dayMap.get(fmt(cursor)).contributionCount > 0) {
      current++;
      cursor = new Date(cursor.getTime() - 86400000);
    }
    for (const d of days) {
      run = d.contributionCount > 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }

    // languages (weighted by stars, tie-break by repo count)
    const langMap = new Map();
    for (const repo of user.repositories.nodes || []) {
      if (!repo.primaryLanguage) continue;
      const entry = langMap.get(repo.primaryLanguage.name) || { name: repo.primaryLanguage.name, color: repo.primaryLanguage.color, stars: 0, repos: 0 };
      entry.stars += repo.stargazerCount;
      entry.repos += 1;
      langMap.set(repo.primaryLanguage.name, entry);
    }
    const topLangs = [...langMap.values()].sort((a, b) => b.stars - a.stars || b.repos - a.repos).slice(0, 3);
    const recentRepos = (user.repositories.nodes || [])
      .filter((r) => r.pushedAt)
      .sort((a, b) => (b.pushedAt < a.pushedAt ? -1 : 1))
      .slice(0, 5);

    return {
      profile: {
        name: user.name || user.login,
        login: user.login,
        avatarUrl: user.avatarUrl,
        bio: user.bio || "",
        url: user.url,
        followers: user.followers.totalCount,
        following: user.following.totalCount,
      },
      stats: {
        totalContrib: cal.totalContributions,
        commits: user.contributionsCollection.totalCommitContributions,
        reviews: user.contributionsCollection.totalPullRequestReviewContributions,
        issues: user.contributionsCollection.totalIssueContributions,
        last7: countSince(7),
        last30: countSince(30),
        today: dayMap.has(fmt(today)) ? dayMap.get(fmt(today)).contributionCount : 0,
        currentStreak: current,
        longestStreak: longest,
        repos: user.repositories.totalCount,
        stars: user.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
        forks: user.repositories.nodes.reduce((a, r) => a + r.forkCount, 0),
        topLangs,
        recentRepos: recentRepos.map((r) => ({ name: r.name, stars: r.stargazerCount, lang: r.primaryLanguage ? r.primaryLanguage.name : null })),
        weeks: cal.weeks.slice(-15).map((w) => w.contributionDays.map((d) => ({
          date: d.date,
          count: d.contributionCount,
          level: levelIndex(d.level),
        }))),
      },
    };
  }

  function levelIndex(level) {
    switch (level) {
      case "NONE": return 0;
      case "FIRST_QUARTILE": return 1;
      case "SECOND_QUARTILE": return 2;
      case "THIRD_QUARTILE": return 3;
      case "FOURTH_QUARTILE": return 4;
      default: return 0;
    }
  }

  /* Demo data so the pet works with zero setup (clearly labeled). */
  function demoProfile() {
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const weeks = [];
    const LEVEL_ENUM = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];
    const rnd = (seed) => {
      let s = seed % 2147483647;
      if (s <= 0) s += 2147483646;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    };
    const r = rnd(1337);
    // build 20 weeks ending TODAY so streak math includes today
    const start = new Date(today.getTime() - (20 * 7 - 1) * 86400000);
    for (let w = 0; w < 20; w++) {
      const days = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
        let count = 0;
        if (r() > 0.28) count = Math.floor(r() * 5) + 1;
        days.push({ date: fmt(date), contributionCount: count, level: LEVEL_ENUM[Math.min(count, 4)] });
      }
      weeks.push({ contributionDays: days });
    }
    // make the last 9 days (incl. today) active for a streak
    const days = weeks.flatMap((w) => w.contributionDays);
    for (let i = 1; i <= 9; i++) {
      const d = days[days.length - i];
      d.contributionCount = 1 + (i % 3);
      d.level = LEVEL_ENUM[d.contributionCount];
    }
    const totalContrib = days.reduce((a, d) => a + d.contributionCount, 0);
    const recalc = buildStats({
      name: "Demo Dev",
      login: "demo",
      avatarUrl: "",
      bio: "Demo data — connect your GitHub to power this pet with real stats!",
      url: "https://github.com",
      followers: { totalCount: 42 },
      following: { totalCount: 17 },
      repositories: { totalCount: 24, nodes: [
        { name: "pixel-dragon", stargazerCount: 18, forkCount: 3, pushedAt: fmt(new Date()), primaryLanguage: { name: "JavaScript", color: "#f1e05a" } },
        { name: "graphql-pet", stargazerCount: 12, forkCount: 2, pushedAt: fmt(new Date(Date.now() - 86400000)), primaryLanguage: { name: "Python", color: "#3572A5" } },
        { name: "retro-crt", stargazerCount: 9, forkCount: 1, pushedAt: fmt(new Date(Date.now() - 2 * 86400000)), primaryLanguage: { name: "CSS", color: "#563d7c" } },
        { name: "devops-lab", stargazerCount: 4, forkCount: 2, pushedAt: fmt(new Date(Date.now() - 5 * 86400000)), primaryLanguage: { name: "Shell", color: "#89e051" } },
        { name: "raspberry-pi", stargazerCount: 2, forkCount: 0, pushedAt: fmt(new Date(Date.now() - 9 * 86400000)), primaryLanguage: { name: "Python", color: "#3572A5" } },
      ] },
      contributionsCollection: {
        totalCommitContributions: 700,
        totalPullRequestReviewContributions: 45,
        totalIssueContributions: 12,
        contributionCalendar: {
          totalContributions: totalContrib,
          weeks,
        },
      },
    });
    recalc.isDemo = true;
    return recalc;
  }

  const api = { fetchProfile, demoProfile, PROFILE_QUERY };
  if (typeof window !== "undefined") {
    window.GitHubPet = window.GitHubPet || {};
    window.GitHubPet.github = api;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
