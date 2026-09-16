import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service.js';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import path, { extname } from 'node:path';
import { diskStorage } from 'multer';
import { db } from './prisma/db.js';
import fs from 'fs'
import type { Request, Response } from 'express'


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

  @Get('stream/:videoId')
  @Header('Content-Type', 'video/mp4')
  async streamVideo(@Param('videoId') videoId: string, @Req() req: Request, @Res() res: Response): Promise<any> {
    const video = await db.orm.public.Video.first({ id: videoId });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    const videoPath = path.join('.', video.url);
    const fileSize = fs.statSync(videoPath).size;

    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunkSize = end - start + 1;
      const file = fs.createReadStream(videoPath, { start, end });

      res.writeHead(HttpStatus.PARTIAL_CONTENT, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': `bytes`,
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4'
      });

      return file.pipe(res);
    }
  }
}
