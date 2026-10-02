const { selfApiUrl } = require('../routes(api)/utils/selfUrl');

describe('selfApiUrl', () => {
  it('keeps a visitor parameter inside one path segment', () => {
    const url = selfApiUrl('http://127.0.0.1:3000', '/api/course/course-details/', '../../admin/agents/jobs?x=1#y');
    expect(url).toBe('http://127.0.0.1:3000/api/course/course-details/..%2F..%2Fadmin%2Fagents%2Fjobs%3Fx%3D1%23y');
    expect(new URL(url).pathname.startsWith('/api/course/course-details/')).toBe(true);
    expect(selfApiUrl('http://h', '/a/', 42)).toBe('http://h/a/42');
  });
});
