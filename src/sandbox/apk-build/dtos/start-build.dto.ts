import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type {
  ApkBuildMode,
  ApkBuildPlatform,
  AndroidBuildType,
} from '../../preview/preview.interface.js';

export class StartApkBuildDto {
  @ApiProperty({
    enum: ['local', 'cloud'],
    default: 'local',
    description:
      'Where to run the build. "cloud" submits to Expo EAS Build using the user\'s saved access token.',
  })
  @IsOptional()
  @IsIn(['local', 'cloud'])
  mode?: ApkBuildMode;

  @ApiProperty({
    enum: ['android', 'ios'],
    default: 'android',
    description:
      'Target platform. iOS is cloud-only and produces a simulator archive by default.',
  })
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: ApkBuildPlatform;

  @ApiProperty({
    enum: ['apk', 'aab'],
    default: 'apk',
    description:
      'Android artifact type. Only meaningful when platform="android". "aab" is Play Store upload format and requires cloud mode.',
  })
  @IsOptional()
  @IsIn(['apk', 'aab'])
  buildType?: AndroidBuildType;
}
