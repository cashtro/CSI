// Keep the engine's logger quiet during tests.
beforeAll(() => {
  for (const m of ['log', 'warn', 'error']) jest.spyOn(console, m).mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());
