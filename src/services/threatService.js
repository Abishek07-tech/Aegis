import { threatMock } from '../data/mock/threats.js'
import { createService } from './serviceFactory.js'
export const threatService=createService({endpoint:'/api/threats',mock:threatMock,collection:true})
