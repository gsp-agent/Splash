import { mat4 } from 'wgpu-matrix'

export const renderUniformsValues = new ArrayBuffer(272);
export const renderUniformsViews = {
  texelSize: new Float32Array(renderUniformsValues, 0, 2),
  sphereSize: new Float32Array(renderUniformsValues, 8, 2),
  invProjectionMatrix: new Float32Array(renderUniformsValues, 16, 16),
  projectionMatrix: new Float32Array(renderUniformsValues, 80, 16),
  viewMatrix: new Float32Array(renderUniformsValues, 144, 16),
  invViewMatrix: new Float32Array(renderUniformsValues, 208, 16),
};

export class Camera {
    isDragging: boolean
    prevX: number
    prevY: number
    prevHoverX = -1
    prevHoverY = -1
    currentHoverX = -1
    currentHoverY = -1
    pointerInside = false
    currentXtheta: number
    currentYtheta: number
    maxYTheta: number
    minYTheta: number
    sensitivity: number
    currentDistance: number
    defaultDistance: number
    maxDistance: number
    minDistance: number
    frameSize: number[]
    aspect: number
    target: number[]
    fov: number
    zoomRate: number

    canvas: HTMLCanvasElement

    constructor (canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        this.canvas.addEventListener("mousedown", (event: MouseEvent) => {
            this.isDragging = true;
            this.prevX = event.clientX;
            this.prevY = event.clientY;
        });

        this.canvas.addEventListener("wheel", (event: WheelEvent) => {
            event.preventDefault();
            var scrollDelta = event.deltaY;
            this.currentDistance += ((scrollDelta > 0) ? 1 : -1) * this.zoomRate;
            if (this.currentDistance < this.minDistance) this.currentDistance = this.minDistance;
            if (this.currentDistance > this.maxDistance) this.currentDistance = this.maxDistance;  
            this.recalculateView()
            this.setNewPrevMouseCoord()
        })

        this.canvas.addEventListener("mousemove", (event: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            this.currentHoverX = event.clientX - rect.left;
            this.currentHoverY = event.clientY - rect.top;
            if (!this.pointerInside) this.setNewPrevMouseCoord();
            this.pointerInside = true;
            if (this.isDragging) {
                const deltaX = this.prevX - event.clientX;
                const deltaY = this.prevY - event.clientY;
                this.currentXtheta += this.sensitivity * deltaX;
                this.currentYtheta += this.sensitivity * deltaY;
                if (this.currentYtheta > this.maxYTheta) this.currentYtheta = this.maxYTheta
                if (this.currentYtheta < this.minYTheta) this.currentYtheta = this.minYTheta
                this.prevX = event.clientX;
                this.prevY = event.clientY;
                this.recalculateView()
                this.setNewPrevMouseCoord()
            }
        });
        
        this.canvas.addEventListener("mouseup", () => {
            if (this.isDragging) this.isDragging = false;
        });
        this.canvas.addEventListener("mouseleave", () => {
            this.pointerInside = false;
            this.isDragging = false;
            this.currentHoverX = this.currentHoverY = -1;
            this.setNewPrevMouseCoord();
        });
    }

    reset(boxSize: number[], target: number[], fov: number, zoomRate: number) {
        this.isDragging = false
        this.pointerInside = false
        this.currentHoverX = this.currentHoverY = -1
        this.setNewPrevMouseCoord()
        this.prevX = 0
        this.prevY = 0
        this.currentXtheta = -Math.PI / 2 * 1
        this.maxYTheta = -Math.PI / 12. * 0.8
        this.minYTheta = -Math.PI / 2.
        this.currentYtheta = this.minYTheta
        this.sensitivity = 0.005
        this.defaultDistance = 0
        this.currentDistance = 0
        this.aspect = 0
        // Existing particle walls are [3, boxSize - 4]. At this azimuth Z is screen width.
        this.frameSize = [boxSize[2] - 7, boxSize[0] - 7]
        this.target = target
        this.fov = fov
        this.zoomRate = zoomRate
        this.updateViewport()
    }

    updateViewport() {
        const aspect = Math.max(this.canvas.clientWidth, 1) / Math.max(this.canvas.clientHeight, 1)
        if (aspect === this.aspect) return

        const zoom = this.defaultDistance ? this.currentDistance / this.defaultDistance : 1
        this.aspect = aspect
        // Cover the bed with a small crop, keeping the same world scale on both screen axes.
        this.defaultDistance = 0.96 * Math.min(this.frameSize[0] / aspect, this.frameSize[1]) / (2 * Math.tan(this.fov / 2))
        this.currentDistance = this.defaultDistance * zoom
        this.maxDistance = 1.3 * this.defaultDistance
        this.minDistance = 0.8 * this.defaultDistance

        const projection = mat4.perspective(this.fov, aspect, 0.1, 300)
        renderUniformsViews.projectionMatrix.set(projection)
        renderUniformsViews.invProjectionMatrix.set(mat4.inverse(projection))
        this.recalculateView()
        this.setNewPrevMouseCoord()
    }

    recalculateView() {
        var mat = mat4.identity();
        mat4.translate(mat, this.target, mat)
        mat4.rotateY(mat, this.currentXtheta, mat)
        mat4.rotateX(mat, this.currentYtheta, mat)
        mat4.translate(mat, [0, 0, this.currentDistance], mat)
        // The orbit transform defines up even at the overhead pole, where lookAt's world-up degenerates.
        renderUniformsViews.viewMatrix.set(mat4.inverse(mat))
        renderUniformsViews.invViewMatrix.set(mat)
    }

    calcMouseVelocity() {
        if (this.isDragging || !this.pointerInside) {
            return [0, 0]
        }

        let [mousePlaneX, mousePlaneY] = this.calcPlaneCoord(this.currentHoverX, this.currentHoverY)
        let [prevMousePlaneX, prevMousePlaneY] = this.calcPlaneCoord(this.prevHoverX, this.prevHoverY)

        // これはスケールも重要なので正規化してはいけない
        let mouseVelocityX = mousePlaneX - prevMousePlaneX
        let mouseVelocityY = mousePlaneY - prevMousePlaneY
        // 適当に clamp
        let clampValue = 4.
        if (mouseVelocityX > clampValue) mouseVelocityX = clampValue;
        if (mouseVelocityX < -clampValue) mouseVelocityX = -clampValue;
        if (mouseVelocityY > clampValue) mouseVelocityY = clampValue;
        if (mouseVelocityY < -clampValue) mouseVelocityY = -clampValue;
        let mouseViewVelocity = [mouseVelocityX, mouseVelocityY, 0, 0]



        // ワールド座標に直すのはコンピュートシェーダーで
        return mouseViewVelocity
    }

    calcPlaneCoord(x: number, y: number) {
        // MouseEvent coordinates are CSS pixels, not the downscaled render target.
        let normalizedX = x / this.canvas.clientWidth
        let normalizedY = y / this.canvas.clientHeight
        let ndcX = 2.0 * normalizedX - 1.0
        let ndcY = (1.0 - normalizedY) * 2.0 - 1.0

        let viewSpaceMouseRay = [
            ndcX * Math.tan(this.fov / 2.0) * (this.canvas.clientWidth / this.canvas.clientHeight),
            ndcY * Math.tan(this.fov / 2.0), 
            -1.0
        ]

        return [viewSpaceMouseRay[0] * this.currentDistance, viewSpaceMouseRay[1] * this.currentDistance]
    }

    setNewPrevMouseCoord() {
        this.prevHoverX = this.currentHoverX;
        this.prevHoverY = this.currentHoverY;
    }

    stepAngle() {
        this.currentXtheta += 0.012
        this.recalculateView()
    }
}
