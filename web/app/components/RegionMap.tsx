"use client";

interface Node {
  region: string;
  rows: number | null;
  down: boolean;
  primary?: boolean;
}

/**
 * Live memory topology — three region nodes in a replication mesh. Links carry
 * a subtle animated dash to suggest replication; a downed region dims and its
 * links fade. Extends the flight-recorder motif (dark instrument surface).
 */
export function RegionMap({ nodes }: { nodes: Node[] }) {
  const pts = [
    { x: 60, y: 96 },
    { x: 190, y: 44 },
    { x: 320, y: 96 },
  ];
  const n = nodes.slice(0, 3);
  const short = (r: string) => r.replace(/^aws-/, "");

  const edges = [
    [0, 1],
    [1, 2],
    [0, 2],
  ];

  return (
    <div className="regionmap">
      <svg viewBox="0 0 380 150" width="100%" role="img" aria-label="Region replication topology">
        {edges.map(([a, b], i) => {
          if (a >= n.length || b >= n.length) return null;
          const faded = n[a].down || n[b].down;
          return (
            <line
              key={i}
              x1={pts[a].x}
              y1={pts[a].y}
              x2={pts[b].x}
              y2={pts[b].y}
              className={`rm-link${faded ? " faded" : ""}`}
            />
          );
        })}
        {n.map((node, i) => (
          <g key={node.region} className={`rm-node${node.down ? " down" : ""}`}>
            <circle cx={pts[i].x} cy={pts[i].y} r={node.primary ? 9 : 7} className="rm-dot" />
            {node.primary && <circle cx={pts[i].x} cy={pts[i].y} r={14} className="rm-ring" />}
            <text x={pts[i].x} y={pts[i].y - 20} textAnchor="middle" className="rm-count">
              {node.down ? "down" : node.rows == null ? "—" : node.rows.toLocaleString()}
            </text>
            <text x={pts[i].x} y={pts[i].y + 26} textAnchor="middle" className="rm-region">
              {short(node.region)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
