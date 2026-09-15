import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service.js';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { extname } from 'node:path';
import { diskStorage } from 'multer';
import { db } from './prisma/db.js';

interface UploadVideoBody {
  title?: string;
  description?: string;
  duration?: number;
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('video')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        dest: './uploads',
        storage: diskStorage({
          destination: './uploads',
          filename: (_req, file, cb) => {
            return cb(
              null,
              `${Date.now()}-${randomUUID()}${extname(file.originalname)}`,
            );
          },
        }),
        fileFilter: (_req, file, cb) => {
          if (file.mimetype !== 'video/mp4' && file.mimetype !== 'image/jpeg') {
            return cb(
              new BadRequestException(
                'Invalid file type. Only video/mp4 and image/jpeg are supported.',
              ),
              false,
            );
          }
          return cb(null, true);
        },
      },
    ),
  )
  async uploadVideo(
    @Req() _req: Request,
    @Body() body: UploadVideoBody,
    @UploadedFiles()
    files: { video?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] },
  ): Promise<unknown> {
    const video = files.video?.[0];
    const thumbnail = files.thumbnail?.[0];
    const duration = Number(body.duration);

    if (!video || !thumbnail) {
      throw new BadRequestException(
        'Both video and thumbnail files are required.',
      );
    }

    if (
      !video ||
      !body.title ||
      !body.description ||
      !Number.isFinite(duration)
    ) {
      throw new BadRequestException(
        'video, title, description and duration are required.',
      );
    }

    const now = new Date().toISOString();
    const insertVideo = db.sql.public.video
      .insert([
        {
          id: randomUUID(),
          title: body.title,
          description: body.description,
          url: video.path,
          sizeInKb: video.size,
          duration,
          thumbnailUrl: thumbnail?.path ?? null,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning(
        'id',
        'title',
        'description',
        'url',
        'sizeInKb',
        'duration',
        'thumbnailUrl',
        'createdAt',
        'updatedAt',
      )
      .build();
      
    const [createdVideo] = await db.runtime().query(insertVideo);

    return createdVideo;
  }
}
