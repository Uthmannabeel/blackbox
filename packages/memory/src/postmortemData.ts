import type { Severity } from "./types.js";

/**
 * Real public incident postmortems, ingested into episodic memory alongside the
 * synthetic fleet history. Every entry links to the first-party postmortem
 * (vendor blog / official report) and every URL is verified at ingest-authoring
 * time — the evidence ledger surfaces these links, so a recalled memory can be
 * checked against the public record.
 *
 * Summaries are deliberately conservative paraphrases of the published reports.
 */

export interface PublicPostmortem {
  company: string;
  /** Real-world incident date, YYYY-MM-DD (used for opened_at/resolved_at). */
  date: string;
  title: string;
  summary: string;
  severity: Severity;
  resolution: string;
  url: string;
}

/** All public postmortems attach to this single fleet record. */
export const POSTMORTEM_SERVICE = {
  name: "industry-postmortems",
  team: "public-record",
} as const;

export const PUBLIC_POSTMORTEMS: PublicPostmortem[] = [
  {
    company: "GitLab",
    date: "2017-01-31",
    title: "GitLab.com database outage with data loss after accidental deletion on the primary",
    summary:
      "While fighting replication lag, an engineer intending to wipe a broken secondary ran the removal against the primary's PostgreSQL data directory. Multiple backup and replication mechanisms turned out to be broken or unconfigured, so the freshest usable copy was an ~6-hour-old LVM snapshot from staging.",
    severity: "SEV1",
    resolution:
      "Restored from the staging LVM snapshot, accepting ~6 hours of lost issues, merge requests, and comments. Follow-up: tested, monitored backups (WAL archiving with alerting), and guardrails on destructive operations against production hosts.",
    url: "https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/",
  },
  {
    company: "Amazon Web Services",
    date: "2017-02-28",
    title: "S3 service disruption in us-east-1 after a playbook command removed too much index capacity",
    summary:
      "A debugging playbook command was entered with a typo and removed a larger set of servers than intended from the S3 index subsystem. The index and placement subsystems required a full restart, which had not been done at that scale in years; S3 APIs (and services depending on S3, including the status dashboard) were down for roughly four hours.",
    severity: "SEV1",
    resolution:
      "The capacity-removal tool was changed to remove capacity more slowly and to refuse to take any subsystem below its minimum capacity floor; index recovery was re-partitioned to restart faster; the service dashboard's S3 dependency was removed.",
    url: "https://aws.amazon.com/message/41926/",
  },
  {
    company: "Amazon Web Services",
    date: "2015-09-20",
    title: "DynamoDB outage in us-east-1 from a metadata-service retry storm",
    summary:
      "A brief network disruption caused storage servers' membership-metadata requests to time out. The simultaneous retries overwhelmed the metadata service, which lacked the capacity headroom for the new (larger) membership data driven by Global Secondary Indexes, cascading into elevated errors for DynamoDB and dependent services.",
    severity: "SEV1",
    resolution:
      "Significantly increased metadata-service capacity, lengthened timeouts and reduced retry aggressiveness on storage servers, and added strict instrumentation and throttles to stop a repeat retry storm.",
    url: "https://aws.amazon.com/message/5467D2/",
  },
  {
    company: "Amazon Web Services",
    date: "2020-11-25",
    title: "Kinesis front-end outage in us-east-1 after fleet growth exceeded an OS thread limit",
    summary:
      "Adding capacity to the Kinesis front-end fleet pushed each server past an operating-system thread limit, because every front-end server maintained a thread for every other server. Shard-map construction failed fleet-wide, and recovery required a slow, staged restart; CloudWatch, Cognito, and other dependent services were impaired.",
    severity: "SEV1",
    resolution:
      "Moved to larger servers to cut fleet count, raised OS limits, accelerated cellularization of the front-end fleet, and decoupled dependent services (like Cognito) from hard Kinesis dependencies.",
    url: "https://aws.amazon.com/message/11201/",
  },
  {
    company: "Amazon Web Services",
    date: "2021-12-07",
    title: "us-east-1 impairment from congestion between the internal network and the main AWS network",
    summary:
      "An automated scaling activity triggered an unexpected surge of connection activity that overwhelmed networking devices between AWS's internal network and the main network. Retry storms sustained the congestion, internal DNS and monitoring were impaired, and many services in us-east-1 were degraded for several hours.",
    severity: "SEV1",
    resolution:
      "Disabled the triggering scaling activities, throttled and fixed client back-off behavior, moved internal DNS off the congested paths, and committed to isolating internal-network dependencies and improving out-of-band operational tooling.",
    url: "https://aws.amazon.com/message/12721/",
  },
  {
    company: "Cloudflare",
    date: "2019-07-02",
    title: "Global CPU exhaustion from a WAF rule with a catastrophically backtracking regex",
    summary:
      "A new WAF rule containing a regular expression prone to catastrophic backtracking was deployed globally in one step. CPU on every edge PoP saturated and Cloudflare served 502s worldwide for about 27 minutes — the deploy pipeline treated WAF rules as fast-path changes that skipped staged rollout.",
    severity: "SEV1",
    resolution:
      "Globally disabled the WAF, then rolled back the rule; introduced staged rollouts and emergency kill switches for WAF changes and moved toward a regex engine with guaranteed linear-time matching.",
    url: "https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/",
  },
  {
    company: "Cloudflare",
    date: "2022-06-21",
    title: "Outage in 19 busiest data centers from a BGP policy change ordering error",
    summary:
      "A change to prefix advertisement policy, part of rolling out a new more-resilient data-center architecture, reordered terms in a way that withdrew critical prefixes in Cloudflare's 19 largest locations. Roughly half of global traffic was affected for about 1.5 hours.",
    severity: "SEV1",
    resolution:
      "Rolled back the change and restored advertisements; tightened staged deployment for network policy changes and adjusted procedures so the busiest locations aren't in a single rollout step.",
    url: "https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/",
  },
  {
    company: "Cloudflare",
    date: "2023-11-02",
    title: "Multi-day control-plane and analytics outage after a data-center power failure",
    summary:
      "A power failure at a core data center took down the facility hosting most of Cloudflare's control plane and analytics. Many internal services assumed that facility's availability and did not fail over cleanly to the other core sites, so while the edge kept serving traffic, control-plane features and analytics were degraded for days.",
    severity: "SEV1",
    resolution:
      "Failed over to the secondary core facility, then repatriated services; launched a program to remove single-data-center assumptions from control-plane services and to regularly test full data-center-loss failover.",
    url: "https://blog.cloudflare.com/post-mortem-on-cloudflare-control-plane-and-analytics-outage/",
  },
  {
    company: "GitHub",
    date: "2018-10-21",
    title: "24-hour degradation after a 43-second network partition caused a MySQL split-brain",
    summary:
      "A brief connectivity loss between the US East Coast data center and its network hub led orchestration tooling to promote a West Coast MySQL primary while unreplicated writes existed on the East Coast. To avoid losing either side's writes, GitHub ran degraded for about 24 hours while reconciling and backfilling data.",
    severity: "SEV1",
    resolution:
      "Paused webhooks and Pages builds, restored from backups where needed, and reconciled the divergent writes; longer-term, invested in multi-region write topology and clearer status communication.",
    url: "https://github.blog/2018-10-30-oct21-post-incident-analysis/",
  },
  {
    company: "Slack",
    date: "2021-01-04",
    title: "New-year traffic ramp overwhelmed cloud network gateways, then autoscaling made it worse",
    summary:
      "As holiday traffic returned, AWS Transit Gateways serving Slack did not scale up fast enough, causing packet loss. The degraded network then tripped Slack's own health checks and scaling systems, which scaled down some fleets and overwhelmed provisioning, deepening the outage.",
    severity: "SEV1",
    resolution:
      "AWS manually scaled the Transit Gateways; Slack now pre-scales network capacity ahead of predictable traffic ramps and fixed monitoring/scaling systems that themselves depended on the impaired network.",
    url: "https://slack.engineering/slacks-outage-on-january-4th-2021/",
  },
  {
    company: "Fastly",
    date: "2021-06-08",
    title: "Global CDN outage triggered by a customer configuration hitting a latent bug",
    summary:
      "A valid customer configuration change triggered a latent software bug introduced in a deployment weeks earlier, causing 85% of Fastly's network to return errors. Major sites worldwide were down for roughly 49 minutes before the trigger was identified and disabled.",
    severity: "SEV1",
    resolution:
      "Disabled the triggering configuration, restored the network within an hour, then deployed a permanent bug fix and reviewed rollout and blast-radius controls for configuration-processing code paths.",
    url: "https://www.fastly.com/blog/summary-of-june-8-outage",
  },
  {
    company: "Meta",
    date: "2021-10-04",
    title: "Six-hour global outage after a maintenance command disconnected the backbone",
    summary:
      "A command issued during routine backbone maintenance unintentionally took down all backbone connections between Facebook's data centers. The DNS servers, by design, withdrew their BGP advertisements when they could not reach the data centers, taking every Meta property offline and locking engineers out of remote tooling.",
    severity: "SEV1",
    resolution:
      "Engineers restored the backbone from data-center sites and staged the power-up carefully to avoid overload; follow-ups hardened change auditing and out-of-band access for exactly this failure mode.",
    url: "https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/",
  },
  {
    company: "Roblox",
    date: "2021-10-28",
    title: "73-hour outage rooted in Consul streaming plus a BoltDB performance pathology",
    summary:
      "A newly enabled Consul streaming feature, combined with a pathological write pattern in BoltDB's freelist handling under Roblox's load, degraded the central Consul cluster that most services depended on. Diagnosis was slow partly because telemetry itself depended on Consul.",
    severity: "SEV1",
    resolution:
      "Disabled streaming and remediated the BoltDB issue with HashiCorp, then decomposed workloads off the single Consul cluster and moved observability onto infrastructure independent of it.",
    url: "https://blog.roblox.com/2022/01/roblox-return-to-service-10-28-10-31-2021/",
  },
  {
    company: "Monzo",
    date: "2019-07-29",
    title: "Partial data unavailability while scaling up the Cassandra cluster",
    summary:
      "During a planned scale-up, new Cassandra nodes joined the ring and immediately took ownership of key ranges before the data had streamed to them, because of a misunderstood bootstrap setting. A slice of reads returned empty results until the mistake was identified.",
    severity: "SEV2",
    resolution:
      "Stopped the rollout, streamed the data properly and ran repairs to restore consistency; documented and tested the correct scale-up procedure so ownership only transfers after data movement completes.",
    url: "https://monzo.com/blog/2019/09/08/why-monzo-wasnt-working-on-july-29th",
  },
  {
    company: "Let's Encrypt",
    date: "2020-02-29",
    title: "CAA rechecking bug forced a mass certificate revocation plan",
    summary:
      "A bug in the Boulder CA software meant that when a certificate covered N domains, one domain's CAA record was rechecked N times instead of each domain once. Certificates could therefore be issued contrary to CAA policy, and CA rules required revoking millions of affected certificates on short notice.",
    severity: "SEV2",
    resolution:
      "Fixed the rechecking logic, coordinated large-scale reissuance, and revoked the subset of affected certificates judged safe to revoke without breaking a large fraction of the web mid-incident.",
    url: "https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591",
  },
  {
    company: "Atlassian",
    date: "2022-04-05",
    title: "Maintenance script permanently deleted sites for hundreds of cloud customers",
    summary:
      "A script meant to deactivate a legacy standalone app was run with the wrong IDs and in permanent-deletion mode, deleting entire cloud sites for about 775 customers. Restores were done from backups but took up to two weeks for the worst-affected customers.",
    severity: "SEV1",
    resolution:
      "Restored sites from backups customer by customer; moved deletion workflows to universal soft-delete with staged safeguards, and overhauled incident communications for directly affected customers.",
    url: "https://www.atlassian.com/engineering/post-incident-review-april-2022-outage",
  },
  {
    company: "CircleCI",
    date: "2023-01-04",
    title: "Production secrets compromised via malware on an engineer's laptop",
    summary:
      "Malware on an engineer's laptop stole a valid, 2FA-backed SSO session cookie, letting the attacker impersonate the engineer and escalate to production systems, exfiltrating customer environment variables, tokens, and keys. CircleCI advised all customers to rotate every stored secret.",
    severity: "SEV1",
    resolution:
      "Rotated all internal secrets, restricted production access to a smaller group with additional authentication guards, shortened session lifetimes, and added detection for the exfiltration paths used.",
    url: "https://circleci.com/blog/jan-4-2023-incident-report/",
  },
  {
    company: "Heroku",
    date: "2022-04-15",
    title: "Stolen OAuth tokens from a compromised integration exposed customer repos",
    summary:
      "An attacker who compromised Heroku's GitHub integration pipeline exfiltrated OAuth tokens, gaining read access to some customer GitHub repositories, and separately accessed a database of hashed passwords. Heroku revoked the tokens and disabled the GitHub integration for weeks while rebuilding it.",
    severity: "SEV1",
    resolution:
      "Revoked all GitHub integration OAuth tokens, rotated internal credentials, forced password resets, and re-architected the integration before re-enabling it, with a detailed public incident review.",
    url: "https://blog.heroku.com/april-2022-incident-review",
  },
  {
    company: "Google Cloud",
    date: "2019-06-02",
    title: "Multi-hour network degradation after maintenance descheduled control-plane jobs",
    summary:
      "A maintenance event, combined with a software bug, descheduled network control-plane jobs in multiple locations at once. Network capacity in the eastern US dropped sharply, congesting traffic for Google Cloud and consumer services for about four hours, and the congestion also slowed the tooling needed to fix it.",
    severity: "SEV1",
    resolution:
      "Halted the automation, restored the control plane, and changed maintenance and scheduling policies so control-plane jobs in distinct locations cannot be descheduled together.",
    url: "https://status.cloud.google.com/incident/cloud-networking/19009",
  },
  {
    company: "Knight Capital",
    date: "2012-08-01",
    title: "Repurposed feature flag activated dead code on one unpatched server, losing $460M in 45 minutes",
    summary:
      "A manual deploy reached only seven of eight production servers. A repurposed order-routing flag activated long-dead test code ('Power Peg') on the eighth, which sent millions of erroneous orders into the market for 45 minutes before anyone stopped it. The firm lost about $460 million and required rescue financing.",
    severity: "SEV1",
    resolution:
      "Trading was halted after 45 minutes; the failure became the canonical case for automated deployment verification, feature-flag hygiene, and immediate kill switches — codified in the SEC's enforcement order.",
    url: "https://www.sec.gov/litigation/admin/2013/34-70694.pdf",
  },
  {
    company: "Datadog",
    date: "2023-03-08",
    title: "Automatic OS security update simultaneously rebooted network on tens of thousands of nodes",
    summary:
      "A legacy security-update channel was still enabled on a large share of the fleet, and a systemd update applied at the same moment across tens of thousands of VMs in multiple clouds and regions disrupted networking on each as it applied. Intake and monitoring were degraded for many hours while capacity was rebuilt.",
    severity: "SEV1",
    resolution:
      "Disabled the unattended-update channel fleet-wide, rebuilt capacity, backfilled delayed data, and moved OS updates onto the same staged, controlled rollout discipline as code deploys.",
    url: "https://www.datadoghq.com/blog/2023-03-08-deep-dive-into-platform-level-impact/",
  },
  {
    company: "Reddit",
    date: "2023-03-14",
    title: "Kubernetes upgrade broke cluster networking via a renamed node label",
    summary:
      "During a Kubernetes 1.23 to 1.24 upgrade of the primary cluster, a deprecated node label that Calico route reflectors selected on was no longer applied, silently breaking pod networking cluster-wide. The team ultimately restored from backup and rolled back after hours of debugging.",
    severity: "SEV1",
    resolution:
      "Restored the cluster from backup and rolled back the upgrade, then standardized cluster builds so version-skew-sensitive components are validated in staging clusters that faithfully mirror production.",
    url: "https://www.reddit.com/r/RedditEng/comments/11xx5o0/you_broke_reddit_the_piday_outage/",
  },
  {
    company: "GoCardless",
    date: "2017-10-10",
    title: "API outage when the Postgres HA cluster refused automatic failover",
    summary:
      "The Pacemaker-managed PostgreSQL cluster hit a failure mode where the automation could not elect a new primary, and the API and dashboard were down while engineers performed a careful manual promotion under pressure.",
    severity: "SEV2",
    resolution:
      "Manually promoted a healthy replica to restore service, then invested in regularly exercised failover — testing the automation against the specific failure modes it had not handled.",
    url: "https://gocardless.com/blog/incident-review-api-and-dashboard-outage-on-10th-october/",
  },
  {
    company: "Instapaper",
    date: "2017-02-08",
    title: "Write outage after silently hitting a filesystem file-size limit on the database",
    summary:
      "The hosted MySQL instance had been created years earlier on a filesystem with a 2TB per-file limit. When the main table's file hit that ceiling, writes began failing with no prior warning, and recovery required dumping and rebuilding the database on modern infrastructure over more than a day.",
    severity: "SEV1",
    resolution:
      "Rebuilt the database on infrastructure without the legacy limit and restored full history in phases; the lesson — invisible platform limits inherited from old provisioning — became a widely cited cautionary tale.",
    url: "https://medium.com/making-instapaper/instapaper-outage-cause-recovery-3c32a7e9cc5f",
  },
  {
    company: "Cloudflare",
    date: "2020-07-17",
    title: "Backbone configuration error blackholed a large share of global traffic",
    summary:
      "While mitigating congestion on a backbone segment, a configuration change to a router in Atlanta caused it to attract traffic from across the backbone instead of shedding it, dropping roughly half of Cloudflare's inter-data-center traffic for about 27 minutes.",
    severity: "SEV1",
    resolution:
      "Removed the faulty router configuration to restore routing, then added safeguards on backbone configuration changes and re-reviewed the maximum blast radius any single router change can have.",
    url: "https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/",
  },
];
