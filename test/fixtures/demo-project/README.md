# Trailhead (test fixture)

A copy of `examples/demo-project` that the tests copy and assert on. It is separate from the
example so that trying the demo, or changing it, never breaks the tests. Tests always work on a
temporary copy (see `copyDemoProject` in `test/helpers.ts`).
