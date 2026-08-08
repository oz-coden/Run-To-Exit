using UnityEngine;
using UnityEngine.InputSystem;

namespace RunToExit.Core
{
    public class CameraController : MonoBehaviour
    {
        public Transform playerTransform;
        public float followSpeed = 5f;
        public float maxPanDistance = 10f; // マウスによるパンの最大距離
        public float edgeThreshold = 0.2f; // 画面端から何割の領域でパンを開始するか

        private Camera cam;

        private void Start()
        {
            cam = Camera.main;
        }

        private void LateUpdate()
        {
            if (playerTransform == null || cam == null) return;

            Vector3 targetPos = playerTransform.position;
            targetPos.z = transform.position.z;

            // マウスによるパン処理
            if (Mouse.current != null)
            {
                Vector2 mousePos = Mouse.current.position.ReadValue();
                Vector2 viewportPos = cam.ScreenToViewportPoint(mousePos);

                float panX = 0f;
                float panY = 0f;

                // X軸のパン
                if (viewportPos.x < edgeThreshold)
                    panX = -1f + (viewportPos.x / edgeThreshold);
                else if (viewportPos.x > 1f - edgeThreshold)
                    panX = (viewportPos.x - (1f - edgeThreshold)) / edgeThreshold;

                // Y軸のパン
                if (viewportPos.y < edgeThreshold)
                    panY = -1f + (viewportPos.y / edgeThreshold);
                else if (viewportPos.y > 1f - edgeThreshold)
                    panY = (viewportPos.y - (1f - edgeThreshold)) / edgeThreshold;

                // クランプ
                panX = Mathf.Clamp(panX, -1f, 1f);
                panY = Mathf.Clamp(panY, -1f, 1f);

                targetPos.x += panX * maxPanDistance;
                targetPos.y += panY * maxPanDistance;
            }

            transform.position = Vector3.Lerp(transform.position, targetPos, Time.deltaTime * followSpeed);
        }
    }
}
