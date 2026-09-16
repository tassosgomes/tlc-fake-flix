import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import fs from 'fs';
import request from 'supertest';
import { db } from '../src/prisma/db.js';

describe('VideoController (e2e)', () => {
  let module: TestingModule;
  let app: INestApplication;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2023-01-01'));
  });

  afterEach(async () => {
    const videoForDelete = await db.orm.public.Video.select('id').all();

    for (const { id } of videoForDelete) {
      db.orm.public.Video.where({ id: id }).delete();
    }
  });

  afterAll(async () => {
    module.close();
    fs.rmSync('./uploads', { recursive: true, force: true });
  });

  describe('/video (POST)', () => {
    it('uploads a video', async () => {
      const video = {
        title: 'Test Video',
        description: 'This is a test video',
        videoUrl: 'uploads/test.mp4',
        thumbnailUrl: 'uploads/test.jpg',
        sizeInKb: 1430145,
        duration: 100,
      };

      await request(app.getHttpServer())
        .post('/video')
        .attach('video', 'test/fixtures/sample.mp4')
        .attach('thumbnail', 'test/fixtures/sample.jpg')
        .field('title', video.title)
        .field('description', video.description)
        .field('duration', video.duration)
        .expect(HttpStatus.CREATED)
        .expect((response) => {
          expect(response.body).toMatchObject({
            title: video.title,
            description: video.description,
            url: expect.stringContaining('mp4'),
            thumbnailUrl: expect.stringContaining('jpg'),
            sizeInKb: video.sizeInKb,
            duration: video.duration,
          });
        });
    });
    it('throws an error when the thumbnail is not provided', async () => {
      const video = {
        title: 'Test Video',
        description: 'This is a test video',
        videoUrl: 'uploads/test.mp4',
        thumbnailUrl: 'uploads/test.jpg',
        sizeInKb: 1430145,
        duration: 100,
      };

      await request(app.getHttpServer())
        .post('/video')
        .attach('video', 'test/fixtures/sample.mp4')
        .field('title', video.title)
        .field('description', video.description)
        .field('duration', String(video.duration))
        .expect(HttpStatus.BAD_REQUEST)
        .expect((response) => {
          expect(response.body).toMatchObject({
            message: 'Both video and thumbnail files are required.',
            error: 'Bad Request',
            statusCode: 400,
          });
        });
    });
    it('does not allow non mp4 files', async () => {
      const video = {
        title: 'Test Video',
        description: 'This is a test video',
        videoUrl: 'uploads/test.mp4',
        thumbnailUrl: 'uploads/test.jpg',
        sizeInKb: 100,
        duration: 100,
      };

      await request(app.getHttpServer())
        .post('/video')
        .attach('video', './test/fixtures/sample.mp3')
        .attach('thumbnail', './test/fixtures/sample.jpg')
        .field('title', video.title)
        .field('description', video.description)
        .expect(HttpStatus.BAD_REQUEST)
        .expect({
          message:
            'Invalid file type. Only video/mp4 and image/jpeg are supported.',
          error: 'Bad Request',
          statusCode: 400,
        });
    });
  });

  describe('/stream/:videoId', () => {
    it('streams a video', async () => {
      const video = {
        title: 'Test Video',
        description: 'This is a test video',
        videoUrl: 'uploads/test.mp4',
        thumbnailUrl: 'uploads/test.jpg',
        sizeInKb: 1430145,
        duration: 100,
      };

      const { body: sampleVideo } = await request(app.getHttpServer())
        .post('/video')
        .attach('video', 'test/fixtures/sample.mp4')
        .attach('thumbnail', 'test/fixtures/sample.jpg')
        .field('title', video.title)
        .field('description', video.description)
        .field('duration', video.duration)
        .expect(HttpStatus.CREATED);

      const fileSize = 1430145;
      const range = `bytes=0-${fileSize - 1}`;

      const response = await request(app.getHttpServer())
        .get(`/stream/${sampleVideo.id}`)
        .set('Range', range)
        .expect(HttpStatus.PARTIAL_CONTENT);

      expect(response.headers['content-range']).toBe(
        `bytes 0-${fileSize - 1}/${fileSize}`,
      )

      expect(response.headers['accept-ranges']).toBe('bytes')
      expect(response.headers['content-length']).toBe(String(fileSize))
      expect(response.headers['content-type']).toBe('video/mp4')
    });

    it('returns 404 if the video is not found', async () => {
      await request(app.getHttpServer())
        .get('/stream/45705b56-a47f-4869-b736-8f6626c940f8')
        .expect(HttpStatus.NOT_FOUND);
    });
  })
});
