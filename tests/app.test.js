const request = require('supertest');
const app = require('../server');
const { resetData } = require('../src/db');

beforeEach(() => {
  resetData();
});

async function login(email = 'alice@newtonite.com', password = 'secret123') {
  const response = await request(app)
    .post('/api/login')
    .send({ email, password });

  expect(response.status).toBe(200);
  return response.body.token;
}

describe('Newtonite operations app', () => {
  test('seeded user can log in and access dashboard', async () => {
    const token = await login();

    const response = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.counts.total).toBeGreaterThan(0);
  });

  test('viewer role cannot edit work items', async () => {
    const token = await login('derek@newtonite.com');

    const listResponse = await request(app)
      .get('/api/work-items')
      .set('Authorization', `Bearer ${token}`);

    const item = listResponse.body.items[0];

    const response = await request(app)
      .patch(`/api/work-items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'closed', version: item.version });

    expect(response.status).toBe(403);
  });

  test('viewer role cannot create work items', async () => {
    const token = await login('derek@newtonite.com');

    const response = await request(app)
      .post('/api/work-items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Unauthorized request',
        description: 'This should be rejected by the API.',
        team: 'Operations',
        priority: 'low'
      });

    expect(response.status).toBe(403);
  });

  test('stale write rejects concurrent update with 409', async () => {
    const token = await login('brad@newtonite.com');

    const listResponse = await request(app)
      .get('/api/work-items')
      .set('Authorization', `Bearer ${token}`);

    const item = listResponse.body.items[0];
    const staleVersion = item.version;

    await request(app)
      .patch(`/api/work-items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'investigating', version: staleVersion });

    const retryResponse = await request(app)
      .patch(`/api/work-items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'low', version: staleVersion });

    expect(retryResponse.status).toBe(409);
  });

  test('duplicate assignment is idempotent for the same owner', async () => {
    const token = await login('brad@newtonite.com');

    const listResponse = await request(app)
      .get('/api/work-items')
      .set('Authorization', `Bearer ${token}`);

    const item = listResponse.body.items[0];

    const response = await request(app)
      .post(`/api/work-items/${item.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: item.owner_id, version: item.version });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/already matches/i);
  });
});
