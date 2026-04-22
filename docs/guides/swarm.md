# Swarm CLI

Swarm CLI is an agentic pipeline tool. When you are running swarm, you can run it in the background and check for its completion by doing the following:

1. Launch detached: Bash(run_in_background: true) running swarm up qa 2>&1 | tee /tmp/swarm-<N>.log. You
   get back an output-file path.

2. Tail the file with a wide grep filter (not swarm list — the pipeline stages don't register there):

tail -f <output-file> | grep --line-buffered -E \  
 "Starting \(iteration|Completed|failed|error|Error|Pipeline Iteration|Pipeline complete|tester \|  
 All|Tasks: "

Pass that to Monitor with persistent: false, timeout_ms: 3600000 (1 hour — default 5 min is too short;  
 pipelines take 5–20 min).

3. Filter has to catch failure, not just progress. If you only grep for success markers, a crashed stage
   looks identical to "still running." The alternation above covers stage boundaries + crash signatures +
   the tester's "All green and pushed" line + final summary.

4. While waiting, do read-only prep only. Reading files, grepping, drafting the next batch's prompt — all
   safe. Any Edit/Write will collide with the refactor/checker/tester stages modifying the tree.
5. Tester auto-commits + pushes. After the final event, verify with git log --oneline -1.

6. Ignore stale-monitor timeouts from earlier batches. Only the current batch's monitor matters; don't  
   re-arm the old ones.
