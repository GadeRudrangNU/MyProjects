"""Renders the two algorithm animations used in the README.

Each frame is produced by actually running the algorithm (ring expansion for the grid, best-first
branch and bound for the quadtree) on a fixed-seed point set, so the pictures show real search
traces rather than hand-drawn steps.

    python make_diagrams.py            # writes grid-search.gif and quadtree-search.gif next to this file
"""
import heapq
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 640          # square map area in pixels
CAPTION = 64        # caption strip below the map
BG = (15, 23, 34)
GRID_LINE = (36, 52, 71)
POINT = (84, 132, 178)
SCANNED = (31, 66, 102)
BEST = (255, 209, 102)
QUERY = (255, 107, 107)
TEXT = (230, 237, 245)
MUTED = (138, 160, 182)
PRUNED = (60, 44, 52)
OK = (46, 204, 113)


def font(size):
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


F = font(17)
FS = font(14)


def make_points(n, seed):
    """Clustered points in the unit square, a dense core and a sparse fringe."""
    rng = random.Random(seed)
    centers = [(0.30, 0.65, 0.07), (0.72, 0.30, 0.05), (0.62, 0.72, 0.10)]
    pts = []
    while len(pts) < n:
        if rng.random() < 0.15:
            p = (rng.random(), rng.random())
        else:
            cx, cy, s = rng.choice(centers)
            p = (rng.gauss(cx, s), rng.gauss(cy, s))
        if 0.01 < p[0] < 0.99 and 0.01 < p[1] < 0.99:
            pts.append(p)
    return pts


def px(v):
    return int(v * SIZE)


def new_frame():
    img = Image.new("RGB", (SIZE, SIZE + CAPTION), BG)
    return img, ImageDraw.Draw(img)


def caption(d, line1, line2=""):
    d.rectangle([0, SIZE, SIZE, SIZE + CAPTION], fill=(22, 33, 47))
    d.text((14, SIZE + 8), line1, font=F, fill=TEXT)
    if line2:
        d.text((14, SIZE + 34), line2, font=FS, fill=MUTED)


def draw_points(d, pts, highlight=(), dim=()):
    for i, (x, y) in enumerate(pts):
        c = BEST if i in highlight else (PRUNED if i in dim else POINT)
        r = 5 if i in highlight else 3
        d.ellipse([px(x) - r, px(y) - r, px(x) + r, px(y) + r], fill=c)


def draw_query(d, q):
    x, y = px(q[0]), px(q[1])
    d.line([x - 9, y, x + 9, y], fill=QUERY, width=3)
    d.line([x, y - 9, x, y + 9], fill=QUERY, width=3)


def save(frames, name, durations):
    path = os.path.join(HERE, name)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, optimize=True, disposal=2)
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KiB, {len(frames)} frames)")


# ---------------------------------------------------------------- grid ring search

def grid_search():
    pts = make_points(260, seed=11)
    q = (0.16, 0.30)
    cells = 10
    cs = 1.0 / cells
    k = 3
    buckets = {}
    for i, (x, y) in enumerate(pts):
        buckets.setdefault((min(cells - 1, int(x / cs)), min(cells - 1, int(y / cs))), []).append(i)
    cx0, cy0 = min(cells - 1, int(q[0] / cs)), min(cells - 1, int(q[1] / cs))

    def dist(i):
        return math.hypot(pts[i][0] - q[0], pts[i][1] - q[1])

    frames, durations = [], []

    def render(r, scanned, best, bound, title, sub, stop=False):
        img, d = new_frame()
        for (cx, cy) in scanned:
            d.rectangle([px(cx * cs), px(cy * cs), px((cx + 1) * cs), px((cy + 1) * cs)], fill=SCANNED)
        for g in range(cells + 1):
            d.line([px(g * cs), 0, px(g * cs), SIZE], fill=GRID_LINE)
            d.line([0, px(g * cs), SIZE, px(g * cs)], fill=GRID_LINE)
        draw_points(d, pts, highlight=set(best))
        if best and len(best) == k:
            w = dist(best[-1])
            d.ellipse([px(q[0] - w), px(q[1] - w), px(q[0] + w), px(q[1] + w)], outline=BEST, width=2)
        if bound is not None:
            b = bound
            d.ellipse([px(q[0] - b), px(q[1] - b), px(q[0] + b), px(q[1] + b)],
                      outline=OK if stop else MUTED, width=2)
        draw_query(d, q)
        caption(d, title, sub)
        frames.append(img)
        durations.append(1500 if stop else 900)

    render(0, [], [], None, "Nearest 3 from the red cross", "Grid: fixed-size cells, each holding its points")
    best = []
    scanned = []
    for r in range(0, cells):
        ring = [(cx, cy) for cx in range(cx0 - r, cx0 + r + 1) for cy in range(cy0 - r, cy0 + r + 1)
                if max(abs(cx - cx0), abs(cy - cy0)) == r and 0 <= cx < cells and 0 <= cy < cells]
        scanned += ring
        for c in ring:
            best = sorted(best + buckets.get(c, []), key=dist)[:k]
        # distance from the query to the nearest edge of the scanned block
        x0, x1 = (cx0 - r) * cs, (cx0 + r + 1) * cs
        y0, y1 = (cy0 - r) * cs, (cy0 + r + 1) * cs
        edge = min(q[0] - x0, x1 - q[0], q[1] - y0, y1 - q[1])
        done = len(best) == k and dist(best[-1]) < edge
        title = f"Ring {r}: {len(scanned)} cells scanned"
        if len(best) < k:
            sub = f"Only {len(best)} of {k} found so far, widen the search by one ring"
        elif done:
            sub = "3rd-nearest is closer than any unscanned cell can be: stop"
        else:
            sub = "A point in an unscanned cell could still be closer: widen again"
        render(r, list(scanned), list(best), edge, title, sub, stop=done)
        if done:
            break
    save(frames, "grid-search.gif", durations)


# ---------------------------------------------------------------- quadtree search

class Node:
    def __init__(self, x0, y0, x1, y1, depth):
        self.x0, self.y0, self.x1, self.y1, self.depth = x0, y0, x1, y1, depth
        self.items = []
        self.kids = None

    def quadrant(self, p):
        mx, my = (self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2
        return (1 if p[0] >= mx else 0) + (2 if p[1] >= my else 0)


def build_tree(pts, cap):
    root = Node(0, 0, 1, 1, 0)

    def insert(node, i):
        while node.kids:
            node = node.kids[node.quadrant(pts[i])]
        node.items.append(i)
        if len(node.items) > cap and node.depth < 12:
            mx, my = (node.x0 + node.x1) / 2, (node.y0 + node.y1) / 2
            node.kids = [Node(node.x0, node.y0, mx, my, node.depth + 1), Node(mx, node.y0, node.x1, my, node.depth + 1),
                         Node(node.x0, my, mx, node.y1, node.depth + 1), Node(mx, my, node.x1, node.y1, node.depth + 1)]
            moved, node.items = node.items, []
            for j in moved:
                insert(node, j)

    for i in range(len(pts)):
        insert(root, i)
    return root, insert


def leaves(node):
    if node.kids is None:
        yield node
    else:
        for kid in node.kids:
            yield from leaves(kid)


def rect_dist(q, n):
    dx = max(n.x0 - q[0], 0, q[0] - n.x1)
    dy = max(n.y0 - q[1], 0, q[1] - n.y1)
    return math.hypot(dx, dy)


def quadtree_search():
    pts = make_points(260, seed=11)
    q = (0.66, 0.70)
    k = 3
    cap = 6
    frames, durations = [], []

    def draw_tree(d, root, expanded=(), pruned=()):
        for leaf in leaves(root):
            box = [px(leaf.x0), px(leaf.y0), px(leaf.x1), px(leaf.y1)]
            if id(leaf) in expanded:
                d.rectangle(box, fill=SCANNED)
            elif id(leaf) in pruned:
                d.rectangle(box, fill=PRUNED)
            d.rectangle(box, outline=GRID_LINE)

    # Phase 1: build the tree by inserting points in batches, so the splits are visible
    steps = [30, 90, 170, len(pts)]
    for n in steps:
        root, _ = build_tree(pts[:n], cap)
        img, d = new_frame()
        draw_tree(d, root)
        sub_pts = pts[:n]
        for (x, y) in sub_pts:
            d.ellipse([px(x) - 3, px(y) - 3, px(x) + 3, px(y) + 3], fill=POINT)
        caption(d, f"Quadtree after {n} points",
                f"A cell splits into four once it holds more than {cap}: crowded areas get finer cells")
        frames.append(img)
        durations.append(1100)
    root, _ = build_tree(pts, cap)

    # Phase 2: best-first search with a priority queue ordered by distance to each cell or point
    heap = [(rect_dist(q, root), 0, "node", root)]
    counter = 1
    results = []
    expanded, seen_items = set(), set()
    pops = 0
    while heap and len(results) < k:
        key, _, kind, obj = heapq.heappop(heap)
        pops += 1
        if kind == "item":
            results.append(obj)
            label = f"Pop point #{len(results)} at distance {key:.3f}"
            sub = "It is the nearest thing left in the queue, so no unseen point can beat it"
        else:
            if obj.kids:
                for kid in obj.kids:
                    heapq.heappush(heap, (rect_dist(q, kid), counter, "node", kid))
                    counter += 1
                label = f"Expand a cell at distance {key:.3f}"
                sub = "Its four children go into the queue, each keyed by its distance to the query"
            else:
                expanded.add(id(obj))
                for i in obj.items:
                    heapq.heappush(heap, (math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]), counter, "item", i))
                    counter += 1
                label = f"Open a leaf at distance {key:.3f}"
                sub = "Its points are queued with their exact distances"
        if kind == "node" and obj.kids and pops > 8 and len(results) == 0 and pops % 2:
            continue  # keep the animation short: show every other early expansion
        img, d = new_frame()
        draw_tree(d, root, expanded=expanded)
        draw_points(d, pts, highlight=set(results))
        if results:
            w = math.hypot(pts[results[-1]][0] - q[0], pts[results[-1]][1] - q[1])
            d.ellipse([px(q[0] - w), px(q[1] - w), px(q[0] + w), px(q[1] + w)], outline=BEST, width=2)
        draw_query(d, q)
        caption(d, label, sub)
        frames.append(img)
        durations.append(700)

    pruned = {id(leaf) for leaf in leaves(root) if id(leaf) not in expanded}
    img, d = new_frame()
    draw_tree(d, root, expanded=expanded, pruned=pruned)
    draw_points(d, pts, highlight=set(results))
    draw_query(d, q)
    total = len(list(leaves(root)))
    caption(d, f"Done: opened {len(expanded)} of {total} leaves",
            "The red-tinted cells were never opened: their distance exceeded the 3rd-nearest point")
    frames.append(img)
    durations.append(2500)
    save(frames, "quadtree-search.gif", durations)


if __name__ == "__main__":
    grid_search()
    quadtree_search()
