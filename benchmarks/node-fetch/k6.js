// @ts-check

// @ts-expect-error - TS doesn't know this import
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
// @ts-expect-error - TS doesn't know this import
import { githubComment } from 'https://raw.githubusercontent.com/dotansimha/k6-github-pr-comment/master/lib.js';
import http from 'k6/http';
import { Trend } from 'k6/metrics';

const scenarios = ['consumeBody', 'noConsumeBody'];
const fetchTypes = ['native', 'undici', 'nodeHttp', 'curl'];

/** @type{import('k6/options').Options} */
export const options = {
  thresholds: {
    active_handles: ['max<250'], // active handles must be below 250
  },
  scenarios: {},
};

const DURATION = 30;

let index = 0;
for (const scenario of scenarios) {
  for (const fetchType of fetchTypes) {
    options.scenarios[`${scenario}-${fetchType}`] = {
      executor: 'constant-vus',
      vus: 100,
      duration: DURATION + 's',
      gracefulStop: '0s',
      startTime: DURATION * index + 's',
      env: {
        SCENARIO: scenario,
        FETCH_TYPE: fetchType,
      },
    };
    index++;
  }
}

const activeHandles = new Trend('active_handles');

export default function () {
  http.get(`http://localhost:50001/scenarios/${__ENV.SCENARIO}/${__ENV.FETCH_TYPE}`);

  const res = http.get('http://localhost:50001/activeHandles');
  activeHandles.add(parseInt(String(res.body)));
}

export function handleSummary(data) {
  if (__ENV.GITHUB_TOKEN) {
    githubComment(data, {
      token: __ENV.GITHUB_TOKEN,
      commit: __ENV.GITHUB_SHA,
      pr: __ENV.GITHUB_PR,
      org: 'ardatan',
      repo: 'whatwg-node',
      commentKey: `@benchmarks/node-fetch`,
      renderTitle({ passes }) {
        return passes
          ? `✅ \`@benchmarks/node-fetch\` results`
          : `❌ \`@benchmarks/node-fetch\` failed`;
      },
      renderMessage({ passes, checks, thresholds }) {
        const result = [];

        if (thresholds.failures) {
          result.push(`**Performance regression detected**`);
        }

        if (checks.failures) {
          result.push('**Failed assertions detected**');
        }

        if (!passes) {
          result.push(
            `> If the performance regression is expected, please increase the failing threshold.`,
          );
        }

        return result.join('\n');
      },
    });
  }
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
