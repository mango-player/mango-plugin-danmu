import {isObject, deepAssign, addEvent, removeEvent, $, bind, fetchJsonp} from 'mango-helper';
import Danmu from './danmu.js';
import './danmu.css';

const danmakuAPI = '//galaxy.bz.mgtv.com';

const params = function(obj) {
  return Object.keys(obj).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&')
}

/**
 * 插件默认配置
 */
const defaultConfig = {
  lineHeight: 30,
  fontSize: 24,
  mode: 'css',
  updateByVideo: true,
  datamode: 'batch',  // 弹幕数据拉取模式 batch 分批拉取， all 一次性拉取
};

const chimeeDanmu = {
  name: 'mangoDanmu',
  el: 'mango-danmu',
  data: {
    version: '1.0.0',
    status: 'open', // 弹幕状态： 打开 or 关闭

    // 视频信息
    videoinfo: {
      video_id: 4247448,
      playlist_id: '',
      collection_id: 313552
    },

    config: {}, // 后台弹幕开关配置
    interval: 60 * 1000, // 默认区间宽度
    cache: [], // 弹幕缓存池
    _currentTime: 0,
    lastCurrentTime: 0,
    fetchLock: true, // 拉取数据的锁

    danmu: {},


    danmuList: [],
    currentPostion: 0, // 目前弹幕指针的位置
    currentPiece: {} // 目前弹幕指针所指的弹幕片
  },
  operable: true,
  penetrate: true,
  level: 2,
  create () {
  },
  init (videoConfig) {
    if(videoConfig && videoConfig.danmu === false) return;
    const config = isObject(this.$config) ? deepAssign(defaultConfig, this.$config) : defaultConfig;
    this.danmu = new Danmu(this, config);
    addEvent(window, 'resize', this._resize);
    addEvent(document, 'visibilitychange', this.onVisibilityChange);

    this.updateByVideo = config.updateByVideo;
    this.datamode = config.datamode;
  },
  inited () {
    !this.updateByVideo && this.danmu.start();
  },
  destroy () {
    this.danmu.destroy();
    this.$dom.parentNode.removeChild(this.$dom);
    removeEvent(window, 'resize', this._resize);
    removeEvent(document, 'visibilitychange', this.onVisibilityChange);
  },
  events: {
    videoPlay () {
      console.log('videoPlay')
      if(!this.updateByVideo) return;
      this.status === 'open' && this.danmu.start();
      this.fetchLock = false;
    },
    videoResume () {
      console.log('videoResume')
      if(!this.updateByVideo) return;
      this.status === 'open' && this.danmu.start();
      this.fetchLock = false;
    },
    videoPause () {
      console.log('videoPause')
      if(!this.updateByVideo) return;
      this.status === 'open' && this.danmu.pause();
      this.fetchLock = true;
    },
    // 视频seek之后进行的弹幕回调处理函数
    seek(){
      this.danmu.clear();
      this._currentTime = this.currentTime * 1000
      this.lastCurrentTime = 0
      this.cache.forEach((list) => {
        list.forEach((item)=>{
          item._sent = false;
        })
      })
    },
    timeupdate () {
      if(this.status === 'close') return;

      // 如果是分批拉取弹幕模式
      if(this.datamode == 'batch') {
        //这里按需拉取弹幕并缓存
        this._currentTime = this.currentTime * 1000
        // 判断是否需要拉取接口数据, 提前5s进行预抓取
        let index = Math.floor(this._currentTime / this.interval)
        if( !this.cache[index] ) {
            // console.log('[弹幕插件] 拉取弹幕数据: ' + this._currentTime + ', index=' + index)
            this._fetchDanmu(this._currentTime)
        }

        // 每间隔2s, 遍历弹幕数组渲染合适的数据
        if(this._currentTime - this.lastCurrentTime > 2000 && this.cache[index]) {
          // console.log('遍历数据：' + index)
          let find = this.cache[index].filter((item) => {
            if ( item.time - this._currentTime < 200 && !item._sent)  {
              return true
            } else {
              return false
            }
          })
          // 抛掉过多的弹幕内容
          find = find.slice(0, 6);

          find.forEach(item => {
            item._sent = true
            this.danmu.emit(item.content)
          })
          this.lastCurrentTime = this._currentTime
        }
      } else {
        // 这里可以留一个限制，限制一秒内数据的展示量
        if(Math.abs(this.currentTime - this.currentPiece.time) > 1 || this.currentPiece.time === undefined) {
          this._searchPosition();
        }
        while(this.currentTime >= this.currentPiece.time && this.currentPiece.time) {
          this.danmu.emit(this.currentPiece);
          this.currentPiece = this.danmuList[this.currentPostion++] || {};
        }
      }
    },
    contextmenu (e) {
      e.preventDefault();
      const p = this.danmu.getPieceByPoint(e.offsetX, e.offsetY); 
      this.$emit('danmuContextmenu', p);     
    },
    // CMS返回结果 请求前贴片广告
    cmsData(data){
      if(data.status == 'loadComplete') {
        this.videoinfo = data.data.info
      }
    }
  },
  methods: {
    _getConfig() {
      const url = danmakuAPI + '/getctlbarrage?' + params({
          version: this.version,
          vid: this.videoinfo.video_id,
          abroad: 0,
          pid: this.videoinfo.playlist_id,
          os: '',
          uuid: '',
          deviceid: '',
          cid: this.videoinfo.collection_id,
          ticket: '',
          mac: '',
          platform: 0
      })
      return fetchJsonp(url)
        .then((response) => response.json())
        .then((json: any)=> {
          if(json && json.status == 0 && json.data) {
            this.config = json.data
          }
        })
    },

    _fetchDanmu (time) {
      if(this.fetchLock) return;

      console.log('[弹幕插件] 拉取弹幕数据: ' + time)
      const url = danmakuAPI + '/rdbarrage?' + params({
        version: this.version,
          vid: this.videoinfo.video_id,
          abroad: 0,
          pid: this.videoinfo.playlist_id,
          os: '',
          uuid: '',
          deviceid: '',
          cid: this.videoinfo.collection_id,
          ticket: '',
          time: parseInt(time),
          mac: '',
          platform: 0
      })
      return fetchJsonp(url, {timeout: 10 * 1000})
        .then((response) => response.json())
        .then((json: any)=> {
          if(json && json.status == 0 && json.data) {
            this.interval = json.data.interval * 1000 
            let time = json.data.next - this.interval / 2
            // 计算当前是第几段弹幕 ，如果存在弹幕数据，则进行缓存
            let index = Math.floor(time / this.interval)
            this.cache[index] = json.data.items || []
          }
        })
    },

    _searchPosition () {
      const len = this.danmuList.length;
      if(len === 0) return;
      if(this.currentTime > this.danmuList[len - 1].time) {
        this.currentPiece = {};
        this.currentPostion = len + 1;
        return;
      }
      if(this.currentTime < this.danmuList[0].time) {
        this.currentPiece = this.danmuList[0];
        this.currentPostion = 0;
        return;
      }
      for(let i = 0; i < len; i++) {
        const item = this.danmuList[i];
        if(item.time >= this.currentTime) {
          this.currentPostion = i;
          this.currentPiece = item;
          break;
        }
      }
    },
    open () {
      this.status = 'open';
      this.danmu.start();
    },
    close () {
      this.status = 'close';
      this.danmu.clear();
      this.danmu.pause();
    },
    start () {
      this.danmu.start();
    },
    pause () {
      this.danmu.pause();
    },
    changeMode (mode) {
      this.danmu.changeMode(mode);
    },
    sendMsg (msg) {
      this.status === 'open' && this.danmu.emit(msg);
    },
    receiveData (data) {
      this.danmuList = data;
      this.currentPiece = this.danmuList[this.currentPostion++] || {};
    },
    _resize () {
      this.danmu.resize();
    },
    onVisibilityChange (){
      this.danmu.clear();
    }
    // getFps () {
    //   return 60;
    // },
    // forbidItem(id) {
    //   thid.danmu.forbid(item);
    // }
  }
};
export default chimeeDanmu;
